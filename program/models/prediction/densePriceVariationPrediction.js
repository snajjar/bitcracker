/******************************************************************************
 * densePricePrediction.js - simple dense model to predict btc price
 *****************************************************************************/

const Model = require('../model');
const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const datatools = require('../../lib/datatools');
const config = require('../../config');

class DensePriceVariationPredictionModel extends Model {
    constructor() {
        super();
        this.trainingOptions = {
            shuffle: true,
            epochs: 300,
            batchsize: 10,
        }

        // cap maximum variance per period to improve neural net's accuracy
        this.maxVariancePerPeriod = 0.01;
    }

    // uniq model name - usefull for save & load
    getName() {
        return "DensePriceVariationPrediction";
    }

    // nb candles to train/predict for this model
    getNbInputPeriods() {
        return 20; // for variations computation
    }

    // asynchronous initialization can't be done in the constructor
    async initialize() {

    }

    createModel() {
        const nbDataInput = this.getNbInputPeriods();
        this.model = tf.sequential({
            layers: [
                tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput, activation: 'relu' }),
                tf.layers.dropout(0.5),
                tf.layers.dense({ units: nbDataInput, activation: 'relu' }),
                tf.layers.dropout(0.5),
                tf.layers.dense({ units: 1, activation: 'relu' }),
            ]
        });
    }

    compile() {
        const optimizer = tf.train.adam(0.01);
        this.model.compile({
            optimizer: optimizer,
            loss: 'meanSquaredError',
            metrics: ['accuracy']
        });
    }

    // method to get a input tensor for this model for an input, from periods of btc price
    getInputTensor(candles) {
        // get variations
        let candleVariations = datatools.dataVariations(candles, this.maxVariancePerPeriod);
        candleVariations = candleVariations.slice(candles.length - this.getNbInputPeriods());

        let inputArray = [];
        _.each(candleVariations, candleVariation => {
            inputArray.push(this.activateVariation(candleVariation.close));
        });
        return tf.tensor2d([inputArray], [1, inputArray.length], 'float32');
    }

    // variation is between [1-maxVariance, 1+maxVariance], map this to [0, 1]
    activateVariation(x) {
        return (x + this.maxVariancePerPeriod - 1) / (2 * this.maxVariancePerPeriod);
    }

    // output is between [0, 1], map this to [1-maxVariance, 1+maxVariance]
    deactivateVariation(x) {
        return x * 2 * this.maxVariancePerPeriod + 1 - this.maxVariancePerPeriod;
    }

    async train(trainCandles, testCandles = null) {
        let trainingSet = trainCandles;
        let testSet = testCandles;
        if (!testSet) {
            // if no test data provided, use a portion of the train data
            [trainingSet, testSet] = datatools.splitData(trainCandles, 0.8);
        }

        let inputs = [];
        let outputs = [];
        let nbPeriods = this.getNbInputPeriods();

        // get price variations
        let candleVariations = datatools.dataVariations(trainingSet, this.maxVariancePerPeriod);

        // build input and output tensors from data
        for (var i = 0; i < candleVariations.length - nbPeriods - 1; i++) {
            // compute the input field from the first nbPeriods periods
            let sampleInputs = [];
            for (var j = 0; j < nbPeriods; j++) {
                let closePrice = candleVariations[i + j].close;
                sampleInputs.push(this.activateVariation(closePrice));
            }
            inputs.push(sampleInputs);

            // compute the output field with from the next period
            let sampleOutput = [];
            let outputClosePrice = candleVariations[i + nbPeriods].close;
            sampleOutput.push(this.activateVariation(outputClosePrice));
            outputs.push(sampleOutput);
        }

        // now, we got our sample, but we're like for increasing the model performance to work on the variations of theses data
        let nbSamples = outputs.length;

        // build our tensors
        const nbDataInput = this.getNbInputPeriods();
        let inputTensor = tf.tensor2d(inputs, [nbSamples, nbDataInput], 'float32');
        let outputTensor = tf.tensor2d(outputs, [nbSamples, 1], 'float32');

        inputTensor.print();
        outputTensor.print();

        // train the model for each tensor
        let options = _.clone(this.trainingOptions);
        options.callbacks = {
            onEpochEnd: async (epoch, logs) => {
                // let acc = await this.accuracy(trainingSet);
                // console.log(`Train set acc: min=${acc.min} avg=${acc.avg} max=${acc.max}`);
                // acc = await this.accuracy(testSet);
                // console.log(`Test set acc: min=${acc.min} avg=${acc.avg} max=${acc.max}`);
                await this.save();
            }
        }
        await this.model.fit(inputTensor, outputTensor, options);

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);
    }

    async predict(candles) {
        let inputCandles = candles.slice(candles.length - this.getNbInputPeriods());
        let inputTensor = this.getInputTensor(inputCandles);

        let outputTensor = this.model.predict(inputTensor);
        let arr = await outputTensor.data();

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        let predictedVariation = this.deactivateVariation(arr[0]);
        let predictedPrice = candles[candles.length - 1].close * predictedVariation;
        return predictedPrice;
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

module.exports = DensePriceVariationPredictionModel;