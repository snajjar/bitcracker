const crypto = require('crypto');

const algorithm = 'aes-256-ctr';
const iv = 'bitcracker-31337'.toString('hex').slice(0, 16);

function getKey(pw) {
    if (pw.length < 8) {
        throw "Error: password should always be at least 8 characters";
    } else {
        let buf = Buffer.from(pw + pw + pw + pw);
        let b64 = buf.toString('base64');
        return b64.slice(0, 32);
    }
}

function encrypt(text, password) {
    let key = getKey(password);
    let cipher = crypto.createCipheriv(algorithm, key, iv);
    let crypted = cipher.update(text, 'utf8', 'hex');
    crypted += cipher.final('hex');
    return crypted;
}

function decrypt(text, password) {
    let key = getKey(password);
    let decipher = crypto.createDecipheriv(algorithm, key, iv);
    let dec = decipher.update(text, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

module.exports = {
    encrypt,
    decrypt
}