const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SUCCESS_URL = process.env.SUCCESS_URL || 'http://localhost:3000/?success=true';
const CANCEL_URL = process.env.CANCEL_URL || 'http://localhost:3000/?canceled=true';
const PRICE_ID = process.env.STRIPE_PRICE_ID;

const validateEmail = (email) => /^[^@]+@[^@]+\.[^@]+$/.test(email);

module.exports = async (req, res) => {
    if (!process.env.STRIPE_SECRET_KEY) {
        console.error('Stripe secret key missing');
        return res.status(500).json({ success: false, error: 'Server configuration error' });
    }

    if (req.method !== 'POST') {
        console.log('Method not allowed:', req.method);
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { email } = req.body;
    console.log('Request body:', req.body);

    if (!email || !validateEmail(email)) {
        console.log('Invalid or missing email:', email);
        return res.status(400).json({ success: false, error: 'Valid email is required' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: email.toLowerCase(),
            line_items: [{ price: PRICE_ID, quantity: 1 }],
            mode: 'subscription',
            success_url: SUCCESS_URL,
            cancel_url: CANCEL_URL,
        });
        console.log('Session created:', session.id);
        return res.status(200).json({ success: true, data: { id: session.id } });
    } catch (error) {
        console.error('Stripe error:', error.message, error.stack);
        return res.status(500).json({ success: false, error: error.message });
    }
};