const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'Loaded' : 'Missing');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, uid } = req.body;
    console.log('Request body:', { email, uid });

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        console.error('Invalid email:', email);
        return res.status(400).json({ error: 'Invalid email' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: email,
            metadata: { uid }, // Pass UID for webhook
            line_items: [{
                price: process.env.STRIPE_PRICE_ID,
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: process.env.SUCCESS_URL,
            cancel_url: process.env.CANCEL_URL,
        });
        console.log('Session created:', session.id);
        res.status(200).json({ id: session.id });
    } catch (error) {
        console.error('Stripe error:', error.message, error.stack);
        res.status(500).json({ error: error.message });
    }
};