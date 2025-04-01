import React, { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { doc, onSnapshot, setDoc, collection, getDocs, deleteDoc, updateDoc, getDoc, addDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendEmailVerification, onAuthStateChanged } from 'firebase/auth';
import { loadStripe } from '@stripe/stripe-js';
import { jsPDF } from 'jspdf';
import { createXai } from '@ai-sdk/xai';
import Fingerprint2 from 'fingerprintjs2';

const TOKEN_LIMIT = 10000;
const STRIPE_PUBLIC_KEY = process.env.REACT_APP_STRIPE_PUBLIC_KEY;
const xai = createXai({ apiKey: process.env.REACT_APP_XAI_API_KEY });

function App() {
    const [user, setUser] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [jd, setJd] = useState('');
    const [masterResume, setMasterResume] = useState('');
    const [resume, setResume] = useState('');
    const [coverLetter, setCoverLetter] = useState('');
    const [applications, setApplications] = useState([]);
    const [userUsage, setUserUsage] = useState(null);
    const [isVerified, setIsVerified] = useState(false);
    const [deviceId, setDeviceId] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            setLoading(false);
            if (currentUser) {
                setIsVerified(currentUser.emailVerified);
                await fetchApplications(currentUser.uid);
                await fetchUsage(currentUser.uid);
                if (currentUser.emailVerified && !userUsage) {
                    await setDoc(doc(db, 'users', currentUser.uid), { paidSubscription: false, email: currentUser.email.toLowerCase() }, { merge: true });
                }
            } else {
                setApplications([]);
                setUserUsage(null);
            }
        });

        Fingerprint2.get((components) => {
            const values = components.map((c) => c.value);
            const fingerprint = Fingerprint2.x64hash128(values.join(''), 31);
            setDeviceId(fingerprint);
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user) return;
        const urlParams = new URLSearchParams(window.location.search);
        const success = urlParams.get('success');
        if (success === 'true') {
            user.getIdToken(true).then(async () => {
                await fetchUsage(user.uid);
                await checkDeviceTrial();
                window.history.replaceState({}, document.title, '/');
            }).catch((error) => console.error('Token refresh error:', error.message));
        }
    }, [user]);

    const fetchApplications = async (uid) => {
        try {
            const appsSnapshot = await getDocs(collection(db, `users/${uid}/applications`));
            const apps = appsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            setApplications(apps);
        } catch (error) {
            console.error('Fetch applications error:', error.message);
        }
    };

    const fetchUsage = async (uid) => {
        try {
            const usageDoc = await getDoc(doc(db, `users/${uid}/usage`, 'tokens'));
            const userDoc = await getDoc(doc(db, 'users', uid));
            const usageData = usageDoc.exists() ? usageDoc.data() : { totalTokens: 0 };
            const userData = userDoc.exists() ? userDoc.data() : { paidSubscription: false };
            setUserUsage({ totalTokens: usageData.totalTokens, paidSubscription: userData.paidSubscription });
        } catch (error) {
            console.error('Fetch usage error:', error.message);
        }
    };

    const checkDeviceTrial = async () => {
        if (!deviceId || !user || !userUsage) return;
        try {
            const deviceDoc = await getDoc(doc(db, 'devices', deviceId));
            if (deviceDoc.exists()) {
                const deviceData = deviceDoc.data();
                const existingUid = deviceData.uid;
                const usageDoc = await getDoc(doc(db, `users/${existingUid}/usage`, 'tokens'));
                const totalTokens = usageDoc.exists() ? usageDoc.data().totalTokens : 0;

                if (existingUid !== user.uid) {
                    if (!userUsage.paidSubscription && totalTokens >= TOKEN_LIMIT) {
                        alert(`Trial limit of ${TOKEN_LIMIT} tokens already used on this device. Please subscribe.`);
                        setUserUsage({ totalTokens, paidSubscription: false });
                        await signOut(auth);
                        setUser(null);
                    } else {
                        if (!userUsage.paidSubscription) {
                            await setDoc(doc(db, `users/${user.uid}/usage`, 'tokens'), { totalTokens }, { merge: true });
                            setUserUsage({ totalTokens, paidSubscription: userUsage.paidSubscription });
                        }
                        await updateDoc(doc(db, 'devices', deviceId), { uid: user.uid });
                    }
                } else if (!userUsage.paidSubscription && totalTokens >= TOKEN_LIMIT) {
                    alert(`Trial limit of ${TOKEN_LIMIT} tokens reached. Please subscribe.`);
                    setUserUsage({ totalTokens, paidSubscription: false });
                }
            } else {
                await setDoc(doc(db, 'devices', deviceId), { trialUsed: true, uid: user.uid, timestamp: new Date().toISOString() });
                if (!userUsage?.paidSubscription && !userUsage?.totalTokens) {
                    await setDoc(doc(db, `users/${user.uid}/usage`, 'tokens'), { totalTokens: 0 }, { merge: true });
                    setUserUsage({ totalTokens: 0, paidSubscription: false });
                }
            }
        } catch (error) {
            console.error('Check device trial error:', error.message);
        }
    };

    const login = async () => {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            setUser(userCredential.user);
            setEmail('');
            setPassword('');
        } catch (error) {
            console.error('Login error:', error.message);
            alert(`Login failed: ${error.message}`);
        }
    };

    const signup = async () => {
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await sendEmailVerification(userCredential.user);
            await setDoc(doc(db, 'users', userCredential.user.uid), {
                email: email.toLowerCase(),
                paidSubscription: false,
            }, { merge: true });
            setUser(userCredential.user);
            setEmail('');
            setPassword('');
            alert('Verification email sent. Please check your inbox.');
        } catch (error) {
            console.error('Signup error:', error.message);
            alert(`Signup failed: ${error.message}`);
        }
    };

    const resendVerification = async () => {
        try {
            await sendEmailVerification(user);
            alert('Verification email resent. Please check your inbox.');
        } catch (error) {
            console.error('Resend error:', error.message);
            alert(`Failed to resend verification email: ${error.message}`);
        }
    };

    const logout = async () => {
        await signOut(auth);
        setUser(null);
    };

    const generateDocs = async () => {
        if (!isVerified) return alert('Please verify your email first.');
        if (!jd) return alert('Please paste a job description.');
        if (!userUsage || !deviceId) return;
        if (!userUsage.paidSubscription && userUsage.totalTokens >= TOKEN_LIMIT) {
            alert(`Trial limit of ${TOKEN_LIMIT} tokens reached. Please subscribe.`);
            return;
        }

        const refinedJd = jd.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/(\n|^)[^\w\n]+/g, '\n').trim();
        const refinedResume = masterResume ? masterResume.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : 'No master resume provided';
        const currentDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

        try {
            const response = await xai.chat.completions.create({
                model: 'grok-2-latest', // Confirm with xAI docs
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert resume writer. Using the job description and master resume provided, create a professional resume and cover letter tailored to the job that will help the candidate stand out. Match their skills and experience to the job requirements clearly. Write in a natural, human tone—avoid AI-sounding phrases like "versatile," "dive in," or "leverage." First, analyze the job description to identify the exact job title and hiring company name. Then, use markdown with four sections: "## Job Title" for the identified job title, "## Company" for the identified hiring company, "## Resume" for the resume, and "## Cover Letter" for the cover letter. For the cover letter, include the date as "${currentDate}" under the candidate’s contact info. If the job title or company is unclear, infer them logically from the description. Output only these sections, no extra text.`,
                    },
                    { role: 'user', content: `Job Description: ${refinedJd}\nMaster Resume: ${refinedResume}` },
                ],
                max_tokens: 1500,
                temperature: 0.5,
            });

            const grokResponse = response.choices[0].message.content;
            const usage = response.usage;

            const jobTitleMatch = grokResponse.match(/## Job Title\n([\s\S]*?)(?=## Company|$)/);
            const companyMatch = grokResponse.match(/## Company\n([\s\S]*?)(?=## Resume|$)/);
            const resumeMatch = grokResponse.match(/## Resume\n([\s\S]*?)(?=## Cover Letter|$)/);
            const coverLetterMatch = grokResponse.match(/## Cover Letter\n([\s\S]*$)/);

            const jobTitle = jobTitleMatch ? jobTitleMatch[1].trim() : 'Untitled Job';
            const company = companyMatch ? companyMatch[1].trim() : 'Unknown';
            let generatedResume = resumeMatch ? resumeMatch[1].trim() : 'Error: Resume not generated';
            let generatedCoverLetter = coverLetterMatch ? coverLetterMatch[1].trim() : 'Error: Cover letter not generated';

            generatedResume = generatedResume.replace(/\*\*|\[|\]|\(http.*?\)/g, '').replace(/^\s*-\s*/gm, '').trim();
            generatedCoverLetter = generatedCoverLetter.replace(/\*\*|\[|\]|\(http.*?\)/g, '').replace(/^\s*-\s*/gm, '').trim();

            setResume(generatedResume);
            setCoverLetter(generatedCoverLetter);
            await saveApplication(generatedResume, generatedCoverLetter, jobTitle, company, usage);
        } catch (error) {
            console.error('AI generation error:', error.message);
            alert(`Failed to generate documents: ${error.message}`);
        }
    };

    const saveApplication = async (generatedResume, generatedCoverLetter, jobTitle, company, usage) => {
        const newTotal = (userUsage.totalTokens || 0) + usage.total_tokens;
        await setDoc(doc(db, `users/${user.uid}/usage`, 'tokens'), { totalTokens: newTotal }, { merge: true });
        setUserUsage((prev) => ({ ...prev, totalTokens: newTotal }));

        const appData = {
            userId: user.uid,
            jd,
            resume: generatedResume,
            coverLetter: generatedCoverLetter,
            date: new Date().toISOString(),
            status: 'Draft',
            company,
            title: jobTitle,
            tokenUsage: usage,
        };
        const docRef = await addDoc(collection(db, `users/${user.uid}/applications`), appData);
        setApplications((prev) => [...prev, { id: docRef.id, ...appData }]);
        setJd('');
    };

    const downloadPDF = (content, filename) => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
        const margin = 20;
        const pageWidth = doc.internal.pageSize.width - 2 * margin;
        const pageHeight = doc.internal.pageSize.height - 2 * margin;
        let fontSize = 12;
        doc.setFont('helvetica');
        doc.setFontSize(fontSize);

        const lines = doc.splitTextToSize(content, pageWidth);
        const lineHeight = fontSize * 1.15;
        const totalHeight = lines.length * lineHeight;

        if (totalHeight > pageHeight) {
            fontSize = Math.floor((pageHeight / lines.length) / 1.15);
            doc.setFontSize(fontSize);
        }

        let y = margin;
        lines.forEach((line) => {
            doc.text(line, margin, y);
            y += fontSize * 1.15;
        });

        doc.save(filename);
    };

    const downloadResumePDF = () => downloadPDF(resume, `${applications[applications.length - 1]?.title || 'Job'}_Resume.pdf`);
    const downloadCoverLetterPDF = () => downloadPDF(coverLetter, `${applications[applications.length - 1]?.title || 'Job'}_CoverLetter.pdf`);

    const deleteApplication = async (id) => {
        await deleteDoc(doc(db, `users/${user.uid}/applications`, id));
        setApplications((prev) => prev.filter((app) => app.id !== id));
    };

    const updateStatus = async (id, newStatus) => {
        await updateDoc(doc(db, `users/${user.uid}/applications`, id), { status: newStatus });
        setApplications((prev) => prev.map((app) => (app.id === id ? { ...app, status: newStatus } : app)));
    };

    const handleSubscribe = async () => {
        try {
            const stripe = await loadStripe(STRIPE_PUBLIC_KEY);
            const response = await fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email }),
            });
            const { success, data, error } = await response.json();
            if (!success) throw new Error(error);
            const result = await stripe.redirectToCheckout({ sessionId: data.id });
            if (result.error) throw new Error(result.error.message);
        } catch (error) {
            console.error('Subscribe error:', error.message);
            alert(`Subscription failed: ${error.message}`);
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    if (!user) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
                <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg">
                    <h1 className="text-3xl font-bold text-indigo-600 mb-6">JobTailor</h1>
                    <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        className="w-full p-3 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        type="password"
                        className="w-full p-3 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button onClick={login} className="w-full bg-indigo-500 text-white p-3 rounded-lg hover:bg-indigo-600 transition mb-2">Login</button>
                    <button onClick={signup} className="w-full bg-green-500 text-white p-3 rounded-lg hover:bg-green-600 transition">Sign Up</button>
                </div>
            </div>
        );
    }

    if (!isVerified) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
                <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg text-center">
                    <h1 className="text-2xl font-bold text-indigo-600 mb-4">Verify Your Email</h1>
                    <p className="text-gray-600 mb-4">A verification email has been sent to {user.email}. Please check your inbox.</p>
                    <button onClick={resendVerification} className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition mb-4">Resend Email</button>
                    <button onClick={logout} className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition">Logout</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="flex justify-between items-center max-w-5xl mx-auto mb-6">
                <h1 className="text-3xl font-bold text-indigo-600">JobTailor</h1>
                <button onClick={logout} className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition">Logout</button>
            </div>

            <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg mb-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Master Resume (Optional)</h2>
                <textarea
                    value={masterResume}
                    onChange={(e) => setMasterResume(e.target.value)}
                    placeholder="Paste your master resume here..."
                    className="w-full p-3 h-24 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
            </div>

            <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg mb-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">New Application</h2>
                <textarea
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder="Paste job description here..."
                    className="w-full p-3 h-32 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                />
                <button onClick={generateDocs} className="w-full bg-indigo-500 text-white p-3 rounded-lg hover:bg-indigo-600 transition">Generate Docs</button>
            </div>

            {(resume || coverLetter) && (
                <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg mb-6">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Generated Documents</h2>
                    {resume && (
                        <div className="mb-4">
                            <h3 className="font-medium text-gray-800">Resume</h3>
                            <textarea
                                value={resume}
                                onChange={(e) => setResume(e.target.value)}
                                className="w-full p-3 h-32 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    )}
                    {coverLetter && (
                        <div className="mb-4">
                            <h3 className="font-medium text-gray-800">Cover Letter</h3>
                            <textarea
                                value={coverLetter}
                                onChange={(e) => setCoverLetter(e.target.value)}
                                className="w-full p-3 h-32 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    )}
                    <div className="flex space-x-4">
                        {resume && <button onClick={downloadResumePDF} className="w-full bg-green-500 text-white p-3 rounded-lg hover:bg-green-600 transition">Download Resume</button>}
                        {coverLetter && <button onClick={downloadCoverLetterPDF} className="w-full bg-green-500 text-white p-3 rounded-lg hover:bg-green-600 transition">Download Cover Letter</button>}
                    </div>
                </div>
            )}

            <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Applications & Tracker</h2>
                {userUsage && (
                    <div className="mb-4">
                        <p className="text-sm text-gray-600">
                            {userUsage.paidSubscription
                                ? 'Subscribed (Unlimited Use)'
                                : `Tokens Used: ${userUsage.totalTokens}/${TOKEN_LIMIT} (Trial)`}
                        </p>
                        {!userUsage.paidSubscription && userUsage.totalTokens >= TOKEN_LIMIT && (
                            <button onClick={handleSubscribe} className="mt-2 bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition">Subscribe Now</button>
                        )}
                    </div>
                )}
                <ul className="space-y-4">
                    {applications.map((app) => (
                        <li key={app.id} className="flex justify-between items-center border-b pb-2">
                            <div>
                                <span className="font-medium">{app.title}</span> at {app.company} ({app.status})
                                <p className="text-sm text-gray-500">{new Date(app.date).toLocaleDateString()}</p>
                                {app.tokenUsage && <p className="text-xs text-gray-400">Tokens: {app.tokenUsage.total_tokens}</p>}
                            </div>
                            <div className="flex space-x-2">
                                <select
                                    value={app.status}
                                    onChange={(e) => updateStatus(app.id, e.target.value)}
                                    className="p-1 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="Draft">Draft</option>
                                    <option value="Applied">Applied</option>
                                    <option value="Interview">Interview</option>
                                    <option value="Rejected">Rejected</option>
                                    <option value="Offer">Offer</option>
                                </select>
                                <button
                                    onClick={() => deleteApplication(app.id)}
                                    className="bg-red-500 text-white p-1 rounded-lg hover:bg-red-600 transition"
                                >
                                    Delete
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

export default App;