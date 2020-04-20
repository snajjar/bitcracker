/******************************************************************************
 * auth.js - authenticate to Kraken
 *****************************************************************************/

const Prompt = require('prompt-password');
const encryption = require('./lib/encryption');
const fs = require('fs-extra');

const auth = async function() {
    var promptPW = new Prompt({
        type: 'password',
        message: 'Choose a local password: (will be required for real operations)',
        name: 'password'
    });
    let password = await promptPW.run();

    var promptAPIKey = new Prompt({
        type: 'password',
        message: 'Kraken API Key',
        name: 'apiKey'
    });
    let apiKey = await promptAPIKey.run();

    var promptSecretAPIKey = new Prompt({
        type: 'password',
        message: 'Kraken Secret API Key',
        name: 'apiKey'
    });
    let secretApiKey = await promptSecretAPIKey.run();

    // store encrypted keys to .env file
    let envFileArr = [
        `KRAKEN_API_KEY=${encryption.encrypt(apiKey, password)}`,
        `KRAKEN_SECRET_API_KEY=${encryption.encrypt(secretApiKey, password)}`
    ];
    let envFileStr = envFileArr.join('\n') + '\n';

    fs.writeFileSync('./.env', envFileStr);
}

module.exports = auth;