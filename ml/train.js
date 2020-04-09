/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const csv = require('./lib/csv');
const modelData = require('./lib/model');
const model = modelData.model;
const utils = require('./lib/utils');
const indicator = require('./lib/indicator');

const trainModel = async function(data) {
    let inputs = [];
    let outputs = [];

    // build input and output tensors from data
    // input tensors are dimension 6
    // output tensors are dimension 4
    // scale all value down by dividing by 1 000 000
    for (var i = 0; i < data.length - modelData.nbPeriods - 1; i++) {
        // compute the input field from the first nbPeriods periods
        let sampleInputs = [];
        for (var j = 0; j < modelData.nbPeriods; j++) {
            let period = data[i + j];
            let activatedInputData = modelData.activateInput(period);
            _.each(activatedInputData, (v) => {
                sampleInputs.push(v);
            });
        }
        inputs.push(sampleInputs);

        // compute the output field with from the next period
        let sampleOutput = [];
        let outputData = data[i + modelData.nbPeriods];
        let activatedOutputData = [
            outputData.min === true,
            outputData.max === true,
            outputData.min !== true && outputData.max !== true
        ]
        //let activatedOutputData = modelData.activateOutput(outputData);
        _.each(activatedOutputData, (v) => {
            sampleOutput.push(v);
        });
        outputs.push(sampleOutput);
    }

    // now, we got our sample, but we're like for increasing the model performance to work on the variations of theses data
    //let inputVariations = datatools.computeDataVariations(inputs);
    //let outputVariations = datatools.computeDataVariations(outputs);
    let nbSamples = outputs.length;

    console.log(`[*] training AI on ${nbSamples} samples`);

    // build our tensors
    let inputTensor = tf.tensor2d(inputs, [nbSamples, modelData.nbDataInput], 'float32');
    let outputTensor = tf.tensor2d(outputs, [nbSamples, modelData.nbDataOutput], 'float32');

    inputTensor.print();
    outputTensor.print();

    // train the model for each tensor
    const response = await model.fit(inputTensor, outputTensor, modelData.trainingOptions);

    tf.dispose(inputTensor);
    tf.dispose(outputTensor);
}

const train = async function(interval) {
    // load data from CSV
    let btcData = await csv.getDataForInterval(interval);
    indicator.addLocalMinMaxIndicator(btcData, 12);

    await trainModel(btcData);

    await model.save(`file://./models/supervised/Cex_BTCEUR_${utils.intervalToStr(interval)}/`);
}

module.exports = train;