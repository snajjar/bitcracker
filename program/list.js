const csv = require('./lib/csv');
const _ = require('lodash');

const list = async function() {
    _.each(await csv.getAssets(), asset => {
        console.log(asset);
    });
}

module.exports = list;