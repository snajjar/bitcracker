/******************************************************************************
 * auth.js - authenticate to Kraken
 *****************************************************************************/

const prompts = require('prompts');
const encryption = require('./lib/encryption');
const fs = require('fs-extra');

const auth = async function() {
    const promptPW = await prompts({
        type: 'password',
        name: 'password',
        message: 'Choose a local password: (will be required for real operations)',
        validate: value => value.length < 8 ? `password is at least 8 chararacters` : true
    });
    let password = await promptPW.password;

    const promptAPIKey = await prompts({
        type: 'password',
        name: 'apiKey',
        message: 'Kraken API Key',
    });
    let apiKey = await promptAPIKey.apiKey;

    var promptSecretAPIKey = await prompts({
        type: 'password',
        message: 'Kraken Secret API Key',
        name: 'secretApiKey'
    });
    let secretApiKey = await promptSecretAPIKey.secretApiKey;

    // store encrypted keys to .env file
    let envFileArr = [
        `KRAKEN_API_KEY=${encryption.encrypt(apiKey, password)}`,
        `KRAKEN_SECRET_API_KEY=${encryption.encrypt(secretApiKey, password)}`
    ];
    let envFileStr = envFileArr.join('\n') + '\n';

    fs.writeFileSync('./.env', envFileStr);
}

module.exports = auth;