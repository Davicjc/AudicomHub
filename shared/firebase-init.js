// ================================================================
// FIREBASE INIT — preencha com os dados do seu projeto Firebase
// Console: https://console.firebase.google.com
// ================================================================

const firebaseConfig = {
  apiKey: "AIzaSyCbsUSRwmX8REUp8koeENae6PeCtaURPRQ",
  authDomain: "hubaudicom.firebaseapp.com",
  projectId: "hubaudicom",
  storageBucket: "hubaudicom.firebasestorage.app",
  messagingSenderId: "478626970633",
  appId: "1:478626970633:web:74385e2bff446c7bd4ccd8"
};

firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const auth = firebase.auth();
