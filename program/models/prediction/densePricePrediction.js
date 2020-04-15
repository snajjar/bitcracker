/******************************************************************************
 * densePricePrediction.js - simple dense model to predict btc price
 *****************************************************************************/

const Model = require('../model');
const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');

class DensePricePredictionModel extends Model {
    constructor() {
        super();
        this.trainingOptions = {
            shuffle: true,
            epochs: 3,
            batchsize: 10,
            //validationSplit: 0.2
        }
    }

    // uniq model name - usefull for save & load
    getName() {
        return "DensePricePrediction";
    }

    // nb candles to train/predict for this model
    getNbInputPeriods() {
        return 5;
    }

    // asynchronous initialization can't be done in the constructor
    async initialize() {

    }

    createModel() {
        const nbDataInput = this.getNbInputPeriods();
        this.model = tf.sequential({
            layers: [
                tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput, activation: 'relu' }),
                //tf.layers.dropout(0.5),
                tf.layers.dense({ units: nbDataInput, activation: 'relu' }),
                //tf.layers.dropout(0.5),
                tf.layers.dense({ units: 1, activation: 'relu' }),
            ]
        });
    }

    compile() {
        const adam = tf.train.adam(0.01);
        this.model.compile({
            optimizer: adam,
            loss: 'meanSquaredError',
            metrics: ['accuracy']
        });
    }

    // method to get a input tensor for this model for an input, from periods of btc price
    getInputTensor(candles) {
        let sizedCandles = candles.slice(candles.length - this.getNbInputPeriods());
        let prices = _.map(sizedCandles, c => c.close);
        return tf.tensor2d([prices], [1, prices.length], 'float32');
    }

    async train(candles) {
        let inputs = [];
        let outputs = [];
        let nbPeriods = this.getNbInputPeriods();

        // build input and output tensors from data
        for (var i = 0; i < candles.length - nbPeriods - 1; i++) {
            // compute the input field from the first nbPeriods periods
            let sampleInputs = [];
            for (var j = 0; j < nbPeriods; j++) {
                let closePrice = candles[i + j].close;
                sampleInputs.push(closePrice);
            }
            inputs.push(sampleInputs);

            // compute the output field with from the next period
            let sampleOutput = [];
            let outputClosePrice = candles[i + nbPeriods].close;
            sampleOutput.push(outputClosePrice);
            outputs.push(sampleOutput);
        }

        // now, we got our sample, but we're like for increasing the model performance to work on the variations of theses data
        //let inputVariations = datatools.computeDataVariations(inputs);
        //let outputVariations = datatools.computeDataVariations(outputs);
        let nbSamples = outputs.length;

        // build our tensors
        const nbDataInput = this.getNbInputPeriods();
        let inputTensor = tf.tensor2d(inputs, [nbSamples, nbDataInput], 'float32');
        let outputTensor = tf.tensor2d(outputs, [nbSamples, 1], 'float32');

        inputTensor.print();
        outputTensor.print();

        // train the model for each tensor
        const response = await this.model.fit(inputTensor, outputTensor, this.trainingOptions);

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);
    }

    async predict(candles) {
        let inputCandles = candles.slice(candles.length - this.getNbInputPeriods());
        let inputTensor = this.getInputTensor(inputCandles);
        // inputTensor.print();
        let outputTensor = this.model.predict(inputTensor);
        // outputTensor.print();
        let arr = await outputTensor.data();

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        let output = arr[0];
        return output;
    }

    async accuracy(periods) {
        let accuracies = [];
        let nbInconsistencies = 0;

        let currPeriods = periods.slice(0, this.getNbInputPeriods() - 1); // no trades in this area
        for (var i = this.getNbInputPeriods(); i < periods.length - 1; i++) {
            let nextPeriod = periods[i];
            currPeriods.push(nextPeriod);

            let realValue = periods[i + 1].close;
            let prediction = await this.predict(currPeriods);
            if (prediction > realValue * 1.5 || prediction < realValue * 0.75) {
                // inconsistent prediction
                nbInconsistencies++;
            } else {
                let loss = Math.abs(realValue - prediction);
                let acc = 1 - (loss / realValue);
                accuracies.push(acc);
                currPeriods.shift();
            }
        }

        return {
            max: _.max(accuracies),
            min: _.min(accuracies),
            avg: _.mean(accuracies),
            inconsistencies: nbInconsistencies / periods.length,
        }
    }
}

module.exports = DensePricePredictionModel;