const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('./utils');

// number of periods of data we provide to the model to determine the output
const nbPeriods = 26; // base for ichimoku indicator

// each of theses informations are processed through sigmoid function
// We'll create a sequential model and train it on a set of nbPeriods period
// Each period will have the following informations:
// - open price
// - high price
// - low price
// - close price
// - vwap (volume weighted average price)  // DISABLED
// - volume
// each of theses informations are processed through sigmoid function
const dataInputFields = [{
        name: "open",
        activate: (x) => { return utils.sigmoid(x) },
        deactivate: (x) => { return utils.logit(x) }
    },
    {
        name: "high",
        activate: (x) => { return utils.sigmoid(x) },
        deactivate: (x) => { return utils.logit(x) }
    },
    {
        name: "low",
        activate: (x) => { return utils.sigmoid(x) },
        deactivate: (x) => { return utils.logit(x) }
    },
    {
        name: "close",
        activate: (x) => { return utils.sigmoid(x) },
        deactivate: (x) => { return utils.logit(x) }
    },
    {
        name: "volume",
        activate: (x) => { return utils.sigmoid(x) },
        deactivate: (x) => { return utils.logit(x) }
    }
];
const nbDataByPeriod = dataInputFields.length;
const activateInput = function(o) {
    let inputs = [];
    _.each(dataInputFields, (f) => {
        inputs.push(f.activate(o[f.name]));
    });
    return inputs;
}

const trainingOptions = {
    shuffle: true,
    epochs: 50,
    batchsize: 10,
    validtionSplit: 0.2
}

// The model will take an input of size nbPeriods * nbDataByPeriod

const nbDataInput = nbPeriods * nbDataByPeriod;

// The model will output a prediction for the next period
// - high price
// - low price

const dataOutputFields = [
    /*
    {
        name: "open",
        activate: (x) => { return x }
    },
    */
    {
        name: "high",
        activate: (x) => { return utils.sigmoid(x) },
        deactivate: (x) => { return utils.logit(x) }
    },
    {
        name: "low",
        activate: (x) => { return utils.sigmoid(x) },
        deactivate: (x) => { return utils.logit(x) }
    },
    /*
    {
        name: "close",
        activate: (x) => { return x }
    },
    */
];
const nbDataOutput = dataOutputFields.length;
const activateOutput = function(o) {
    let outputs = [];
    _.each(dataOutputFields, (f) => {
        outputs.push(f.activate(o[f.name]));
    });
    return outputs;
}
const deactivateOutput = function(arr) {
    let r = {};
    _.each(dataOutputFields, (f, index) => {
        r[f.name] = f.deactivate(arr[index]);
    });
    return r;
}

// thoses values will have to be convert back from sigmoid (using logit function)
const model = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput * 4, activation: 'relu' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: nbDataInput * 2, activation: 'relu' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: nbDataInput, activation: 'relu' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: nbDataOutput, activation: 'relu' }),
    ]
});

const adam = tf.train.adam(0.001);

model.compile({
    optimizer: adam,
    loss: 'meanSquaredError',
    metrics: ['accuracy']
});

module.exports = {
    nbPeriods,
    nbDataByPeriod,
    dataInputFields,
    dataOutputFields,
    nbDataInput,
    nbDataOutput,
    activateInput,
    activateOutput,
    deactivateOutput,
    model,
    trainingOptions
}