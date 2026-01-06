const admin = require('firebase-admin');

// ⚠️ REPLACE WITH YOUR SERVICE ACCOUNT KEY
// Download from: Firebase Console -> Project Settings -> Service Accounts -> Generate Private Key
const serviceAccount = require('../../service-account-key.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const registrationToken = 'YOUR_DEVICE_TOKEN_FROM_APP_LOGS';

const message = {
    notification: {
        title: 'Beruang Financial Alert',
        body: 'You spent RM 50 on "Wants" today. Check your budget!',
    },
    data: {
        type: 'budget_alert',
        amount: '50',
    },
    token: registrationToken,
};

admin.messaging().send(message)
    .then((response) => {
        console.log('Successfully sent message:', response);
    })
    .catch((error) => {
        console.log('Error sending message:', error);
    });
