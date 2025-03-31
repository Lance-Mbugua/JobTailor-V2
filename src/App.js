import React, { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { loadStripe } from '@stripe/stripe-js';

const TOKEN_LIMIT = 10000;
const STRIPE_PUBLIC_KEY = process.env.REACT_APP_STRIPE_PUBLIC_KEY;

function App() {
    const [userUsage, setUserUsage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [jd, setJd] = useState(''); // Job description
    const [generatedDocs, setGeneratedDocs] = useState({ resume: '', coverLetter: '' });

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            if (user) {
                const userRef = doc(db, 'users', user.uid);
                onSnapshot(
                    userRef,
                    (docSnap) => {
                        if (docSnap.exists()) {
                            setUserUsage(docSnap.data());
                        } else {
                            // Initialize new user
                            const initialData = { email: user.email.toLowerCase(), totalTokens: 0, paidSubscription: false };
                            setDoc(userRef, initialData).then(() => setUserUsage(initialData));
                        }
                        setLoading(false);
                    },
                    (error) => {
                        console.error('Snapshot error:', error);
                        setLoading(false);
                    }
                );
            } else {
                setUserUsage(null);
                setLoading(false);
            }
        });
        return () => unsubscribe();
    }, []);

    const login = async () => {
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error('Login error:', error);
            alert('Login failed');
        }
    };

    const logout = () => signOut(auth);

    const handleSubscribe = async () => {
        try {
            const response = await fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: auth.currentUser.email }),
            });
            const { success, data, error } = await response.json();
            if (!success) throw new Error(error);
            const stripe = await loadStripe(STRIPE_PUBLIC_KEY);
            await stripe.redirectToCheckout({ sessionId: data.id });
        } catch (error) {
            console.error('Subscription error:', error);
            alert('Failed to initiate subscription');
        }
    };

    const generateDocs = async () => {
        if (!userUsage || (userUsage.totalTokens >= TOKEN_LIMIT && !userUsage.paidSubscription)) {
            alert('Token limit reached. Please subscribe.');
            return;
        }

        // Mock document generation (replace with actual API call)
        const newTokens = userUsage.totalTokens + 1000; // Example usage
        const docs = { resume: 'Generated Resume', coverLetter: 'Generated Cover Letter' };
        await setDoc(doc(db, 'users', auth.currentUser.uid), { totalTokens: newTokens }, { merge: true });
        setGeneratedDocs(docs);
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    if (!auth.currentUser) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4">Login</h2>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        className="w-full p-2 mb-4 border rounded-lg"
                    />
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        className="w-full p-2 mb-4 border rounded-lg"
                    />
                    <button
                        onClick={login}
                        className="w-full bg-indigo-500 text-white p-2 rounded-lg hover:bg-indigo-600"
                    >
                        Login
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="flex justify-between items-center max-w-5xl mx-auto mb-6">
                <h1 className="text-3xl font-bold text-indigo-600">JobTailor</h1>
                <button
                    onClick={logout}
                    className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition"
                >
                    Logout
                </button>
            </div>

            <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg mb-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">New Application</h2>
                <textarea
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder="Paste job description here..."
                    className="w-full p-3 h-32 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                />
                <button
                    onClick={generateDocs}
                    className="w-full bg-indigo-500 text-white p-3 rounded-lg hover:bg-indigo-600 transition"
                >
                    Generate Docs
                </button>
            </div>

            {Object.values(generatedDocs).some(Boolean) && (
                <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg mb-6">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Generated Documents</h2>
                    {generatedDocs.resume && <textarea value={generatedDocs.resume} readOnly className="w-full p-3 h-32 border rounded-lg mb-4" />}
                    {generatedDocs.coverLetter && <textarea value={generatedDocs.coverLetter} readOnly className="w-full p-3 h-32 border rounded-lg mb-4" />}
                </div>
            )}

            <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Usage Tracker</h2>
                {userUsage && (
                    <div className="mb-4">
                        <p className="text-sm text-gray-600">
                            {userUsage.paidSubscription
                                ? 'Subscribed (Unlimited Use)'
                                : `Tokens Used: ${userUsage.totalTokens ?? 0}/${TOKEN_LIMIT} (Trial)`}
                        </p>
                        {!userUsage.paidSubscription && (userUsage.totalTokens ?? 0) >= TOKEN_LIMIT && (
                            <button
                                onClick={handleSubscribe}
                                className="mt-2 bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition"
                            >
                                Subscribe Now
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;