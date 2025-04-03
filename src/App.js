import { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendEmailVerification, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { jsPDF } from 'jspdf';
import axios from 'axios';
import { loadStripe } from '@stripe/stripe-js';
import Fingerprint2 from 'fingerprintjs2';

const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLIC_KEY);

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
    const [isGuest, setIsGuest] = useState(false);
    const [selectedModel, setSelectedModel] = useState('grok-2-latest');

    const XAI_API_KEY = process.env.REACT_APP_XAI_API_KEY;

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const success = urlParams.get('success');
        if (success === 'true' && user) {
            auth.currentUser.getIdToken(true);
            fetchUsage();
            window.history.replaceState({}, document.title, '/');
        }

        Fingerprint2.get(components => {
            const values = components.map(c => c.value);
            const fingerprint = Fingerprint2.x64hash128(values.join(''), 31);
            setDeviceId(fingerprint);
            checkDeviceTrial(fingerprint);
        });

        if (user) {
            checkVerification();
            fetchApplications();
            fetchUsage();
        }
    }, [user]);

    const checkVerification = async () => {
        await user.reload();
        setIsVerified(user.emailVerified);
        if (user.emailVerified && !userUsage) {
            await setDoc(doc(db, `users/${user.uid}`), { paidSubscription: false, email: user.email, tokensGranted: true }, { merge: true });
            await setDoc(doc(db, `users/${user.uid}/usage`, 'tokens'), { totalTokens: 0 });
        }
    };

    const fetchApplications = async () => {
        const appsSnapshot = await getDocs(collection(db, `users/${user.uid}/applications`));
        setApplications(appsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };

    const fetchUsage = async () => {
        const usageDoc = await getDoc(doc(db, `users/${user.uid}/usage`, 'tokens'));
        const userDoc = await getDoc(doc(db, `users/${user.uid}`));
        const usageData = usageDoc.exists() ? usageDoc.data() : { totalTokens: 0 };
        const userData = userDoc.exists() ? userDoc.data() : { paidSubscription: false };
        setUserUsage({ totalTokens: usageData.totalTokens, paidSubscription: userData.paidSubscription });
    };

    const checkDeviceTrial = async (fingerprint) => {
        if (!fingerprint) return;
        const deviceDoc = await getDoc(doc(db, 'devices', fingerprint));
        if (deviceDoc.exists()) {
            if (!user && !isGuest) setIsGuest(true); // Allow guest mode if trial unused
        } else {
            await setDoc(doc(db, 'devices', fingerprint), { trialUsed: false, timestamp: new Date().toISOString() });
        }
    };

    const login = async () => {
        try {
            await setPersistence(auth, browserLocalPersistence);
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            setUser(userCredential.user);
        } catch (error) {
            alert('Login failed: ' + error.message);
        }
    };

    const signup = async () => {
        try {
            await setPersistence(auth, browserLocalPersistence);
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await sendEmailVerification(userCredential.user);
            await setDoc(doc(db, `users/${userCredential.user.uid}`), {
                email: email,
                paidSubscription: false,
                tokensGranted: true
            }, { merge: true });
            await setDoc(doc(db, `users/${userCredential.user.uid}/usage`, 'tokens'), { totalTokens: 0 });
            alert('Verification email sent. Please check your inbox.');
            setUser(userCredential.user);
        } catch (error) {
            alert('Signup failed: ' + error.message);
        }
    };

    const logout = async () => {
        await signOut(auth);
        setUser(null);
        setIsGuest(false);
    };

    const generateDocs = async () => {
        if (user && !isVerified) return alert('Please verify your email first.');
        if (!jd) return alert('Please paste a job description.');
        if (!deviceId) return;

        if (user) {
            if (!userUsage) return;
            if (userUsage.totalTokens >= 5000 && !userUsage.paidSubscription) {
                alert('Trial limit of 5,000 tokens reached. Please subscribe.');
                return;
            }
        } else if (isGuest) {
            const deviceDoc = await getDoc(doc(db, 'devices', deviceId));
            if (deviceDoc.data().trialUsed) {
                alert('Guest trial already used on this device. Please sign up.');
                return;
            }
        }

        const refinedJd = jd.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/(\n|^)[^\w\n]+/g, '\n').trim();
        const refinedResume = masterResume ? masterResume.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : 'No master resume provided';
        const currentDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

        const attemptRequest = async (retries = 3) => {
            try {
                const response = await axios.post(
                    'https://api.x.ai/v1/chat/completions',
                    {
                        messages: [
                            {
                                role: 'system',
                                content: `You are an expert resume writer. Using the job description and master resume provided, create a professional resume and cover letter tailored to the job that will help the candidate stand out. Match their skills and experience to the job requirements clearly. Write in a natural, human tone—avoid AI-sounding phrases like "versatile," "dive in," or "leverage." First, analyze the job description to identify the exact job title and hiring company name. Then, use markdown with four sections: "## Job Title" for the identified job title, "## Company" for the identified hiring company, "## Resume" for the resume, and "## Cover Letter" for the cover letter. For the cover letter, include the date as "${currentDate}" under the candidate’s contact info. If the job title or company is unclear, infer them logically from the description. Output only these sections, no extra text.`
                            },
                            { role: 'user', content: `Job Description: ${refinedJd}\nMaster Resume: ${refinedResume}` }
                        ],
                        model: selectedModel,
                        max_tokens: 1500,
                        temperature: 0.5,
                        stream: false
                    },
                    { headers: { 'Authorization': `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' } }
                );

                return response;
            } catch (error) {
                if (retries > 0) {
                    console.log(`Retrying... (${retries} attempts left)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return attemptRequest(retries - 1);
                }
                throw error;
            }
        };

        try {
            const response = await attemptRequest();
            const grokResponse = response.data.choices[0].message.content;
            const usage = response.data.usage;

            const jobTitleMatch = grokResponse.match(/## Job Title\n([\s\S]*?)(?=## Company|$)/);
            const companyMatch = grokResponse.match(/## Company\n([\s\S]*?)(?=## Resume|$)/);
            const resumeMatch = grokResponse.match(/## Resume\n([\s\S]*?)(?=## Cover Letter|$)/);
            const coverLetterMatch = grokResponse.match(/## Cover Letter\n([\s\S]*)$/);

            const jobTitle = jobTitleMatch ? jobTitleMatch[1].trim() : 'Untitled Job';
            const company = companyMatch ? companyMatch[1].trim() : 'Unknown';
            let generatedResume = resumeMatch ? resumeMatch[1].trim() : 'Error: Resume not generated';
            let generatedCoverLetter = coverLetterMatch ? coverLetterMatch[1].trim() : 'Error: Cover letter not generated';

            generatedResume = generatedResume.replace(/\*\*|\[|\]|\(http.*?\)/g, '').replace(/^\s*-\s*/gm, '').trim();
            generatedCoverLetter = generatedCoverLetter.replace(/\*\*|\[|\]|\(http.*?\)/g, '').replace(/^\s*-\s*/gm, '').trim();

            setResume(generatedResume);
            setCoverLetter(generatedCoverLetter);
            if (user) saveApplication(generatedResume, generatedCoverLetter, jobTitle, company, usage);
            if (isGuest) {
                await updateDoc(doc(db, 'devices', deviceId), { trialUsed: true });
            }
        } catch (error) {
            console.error('Grok API error:', error.response?.data || error.message);
            alert('Failed to generate documents: ' + (error.response?.data?.error?.message || error.message));
        }
    };

    const saveApplication = async (generatedResume, generatedCoverLetter, jobTitle, company, usage) => {
        const newTotal = (userUsage.totalTokens || 0) + usage.total_tokens;
        await setDoc(doc(db, `users/${user.uid}/usage`, 'tokens'), { totalTokens: newTotal });
        setUserUsage({ ...userUsage, totalTokens: newTotal });

        const appData = {
            userId: user.uid,
            jd,
            resume: generatedResume,
            coverLetter: generatedCoverLetter,
            date: new Date().toISOString(),
            status: 'Draft',
            company,
            title: jobTitle,
            tokenUsage: usage
        };
        const docRef = await addDoc(collection(db, `users/${user.uid}/applications`), appData);
        setApplications([...applications, { id: docRef.id, ...appData }]);
        setJd('');
    };

    const downloadPDF = (content, filename) => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
        doc.setFont('helvetica');
        doc.setFontSize(10);
        doc.setLineHeightFactor(1.2);
        const margin = 40;
        const pageWidth = doc.internal.pageSize.width;
        const maxWidth = pageWidth - 2 * margin;
        const lines = doc.splitTextToSize(content, maxWidth);
        let y = margin;
        lines.forEach(line => {
            if (y > doc.internal.pageSize.height - margin) {
                doc.addPage();
                y = margin;
            }
            doc.text(line, margin, y);
            y += 12;
        });
        doc.save(filename);
    };

    const downloadResumePDF = () => downloadPDF(resume, `${applications[applications.length - 1]?.title || 'Job'}_Resume.pdf`);
    const downloadCoverLetterPDF = () => downloadPDF(coverLetter, `${applications[applications.length - 1]?.title || 'Job'}_CoverLetter.pdf`);

    const deleteApplication = async (id) => {
        await deleteDoc(doc(db, `users/${user.uid}/applications`, id));
        setApplications(applications.filter(app => app.id !== id));
    };

    const updateStatus = async (id, newStatus) => {
        await updateDoc(doc(db, `users/${user.uid}/applications`, id), { status: newStatus });
        setApplications(applications.map(app => app.id === id ? { ...app, status: newStatus } : app));
    };

    const handleSubscribe = async () => {
        const stripe = await stripePromise;
        try {
            const response = await axios.post('/api/create-checkout-session', { email: user.email, uid: user.uid });
            const session = response.data;
            await stripe.redirectToCheckout({ sessionId: session.id });
        } catch (error) {
            alert('Subscription failed: ' + error.message);
        }
    };

    if (!user && !isGuest) {
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
                    <button onClick={signup} className="w-full bg-green-500 text-white p-3 rounded-lg hover:bg-green-600 transition mb-2">Sign Up</button>
                    <button onClick={() => setIsGuest(true)} className="w-full bg-gray-500 text-white p-3 rounded-lg hover:bg-gray-600 transition">Try Now (Guest)</button>
                </div>
            </div>
        );
    }

    if (user && !isVerified) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
                <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg text-center">
                    <h1 className="text-2xl font-bold text-indigo-600 mb-4">Verify Your Email</h1>
                    <p className="text-gray-600 mb-4">A verification email has been sent to {user.email}. Please check your inbox.</p>
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
                <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full p-3 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    <option value="grok-2-latest">Grok (xAI)</option>
                    <option value="other-model">Other Model (Placeholder)</option>
                </select>
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

            {user && (
                <div className="max-w-5xl mx-auto bg-white p-6 rounded-xl shadow-lg">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Applications & Tracker</h2>
                    {userUsage && (
                        <div className="mb-4">
                            <p className="text-sm text-gray-600">Tokens Used: {userUsage.totalTokens}/5000 {userUsage.paidSubscription ? '(Subscribed)' : '(Trial)'}</p>
                            {!userUsage.paidSubscription && userUsage.totalTokens >= 5000 && (
                                <button onClick={handleSubscribe} className="mt-2 bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition">Subscribe Now</button>
                            )}
                        </div>
                    )}
                    <ul className="space-y-4">
                        {applications.map(app => (
                            <li key={app.id} className="flex justify-between items-center border-b pb-2">
                                <div>
                                    <span className="font-medium">{app.title}</span> at {app.company} ({app.status})
                                    <p className="text-sm text-gray-500">{new Date(app.date).toLocaleDateString()}</p>
                                    {app.tokenUsage && (
                                        <p className="text-xs text-gray-400">Tokens: {app.tokenUsage.total_tokens}</p>
                                    )}
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
            )}
        </div>
    );
}

export default App;