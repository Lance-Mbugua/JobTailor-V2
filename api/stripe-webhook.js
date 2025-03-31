const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db } = require('../src/firebase');
const { doc, setDoc, getDocs, query, collection, where } = require('firebase/firestore');

module.exports = async (req, res) => {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
        console.error('Missing Stripe configuration');
        return res.status(500).json({ success: false, error: 'Server configuration error' });
    }

    if (req.method !== 'POST') {
        console.log('Invalid method:', req.method);
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log('Event type:', event.type);

        if (event.type === 'checkout.session.completed') {
            const email = event.data.object.customer_email.toLowerCase();
            console.log('Processing email:', email);

            const usersQuery = query(collection(db, 'users'), where('email', '==', email));
            const usersSnapshot = await getDocs(usersQuery);
            console.log('Query result:', usersSnapshot.size);

            if (usersSnapshot.empty) {
                console.error('No user found for email:', email);
                return res.status(200).json({ success: true, message: 'No user to update' });
            }

            const userDoc = usersSnapshot.docs[0];
            await setDoc(doc(db, 'users', userDoc.id), { paidSubscription: true }, { merge: true });
            await setDoc(doc(db, 'users', userDoc.id, 'usage', 'tokens'), { totalTokens: 0 }, { merge: true });
            console.log('Updated user:', userDoc.id);
        } else if (event.type === 'customer.subscription.deleted') {
            const email = event.data.object.customer_email.toLowerCase();
            const usersQuery = query(collection(db, 'users'), where('email', '==', email));
            const usersSnapshot = await getDocs(usersQuery);

            if (!usersSnapshot.empty) {
                const userDoc = usersSnapshot.docs[0];
                await setDoc(doc(db, 'users', userDoc.id), { paidSubscription: false }, { merge: true });
                console.log('Subscription canceled for:', userDoc.id);
            }
        } else {
            console.log('Unhandled event:', event.type);
        }

        return res.status(200).json({ success: true, message: 'Event processed' });
    } catch (error) {
        console.error('Webhook error:', error.message, error.stack);
        return res.status(error.type === 'StripeSignatureVerificationError' ? 400 : 500).json({
            success: false,
            error: error.message,
        });
    }
};