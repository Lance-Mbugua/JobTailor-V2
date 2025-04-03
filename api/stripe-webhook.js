const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db } = require('../src/firebase');
const { doc, setDoc } = require('firebase/firestore');

async function buffer(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
    try {
        if (req.method !== 'POST') {
            console.log(JSON.stringify({ event: 'method_not_allowed', method: req.method }));
            return res.status(405).send('Method Not Allowed');
        }

        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const rawBody = await buffer(req);

        if (rawBody.length === 0) throw new Error('Empty request body');

        const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        console.log(JSON.stringify({ event: 'webhook_received', type: event.type }));

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const uid = session.metadata.uid;

            const attemptUpdate = async (retries = 3) => {
                try {
                    await setDoc(doc(db, 'users', uid), { paidSubscription: true }, { merge: true });
                    console.log(JSON.stringify({ event: 'subscription_confirmed', uid }));
                } catch (error) {
                    if (retries > 0) {
                        console.log(JSON.stringify({ event: 'retry_update', retries_left: retries }));
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        return attemptUpdate(retries - 1);
                    }
                    throw error;
                }
            };

            await attemptUpdate();
        }

        res.status(200).send('Webhook processed successfully');
    } catch (error) {
        console.error(JSON.stringify({ event: 'webhook_error', message: error.message, stack: error.stack }));
        res.status(500).send(`Server Error: ${error.message}`);
    }
};