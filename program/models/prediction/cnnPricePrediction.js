/******************************************************************************
 * simple dense model to predict btc price
 *****************************************************************************/

const Model = require('../model');
const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const datatools = require('../../lib/datatools');
const config = require('../../config');

class CNNPricePredictionModel extends Model {
    constructor() {
        super();
        this.trainingOptions = {
            shuffle: true,
            epochs: 50,
            batchsize: 50,
            validationSplit: 0.15
        }

        this.nbFeatures = 4;
        this.settings.nbInputPeriods = 24;

        this.scaleMargin = 1.2; // 1.2: we can go 20% higher than the higher value
    }

    // uniq model name - usefull for save & load
    getName() {
        return "CNNPricePrediction";
    }

    // nb candles to train/predict for this model
    getNbInputPeriods() {
        return this.settings.nbInputPeriods; // for variations computation
    }

    // asynchronous initialization can't be done in the constructor
    async initialize() {

    }

    createModel() {
        const nbPeriods = this.getNbInputPeriods();

        let model = tf.sequential();

        // add a conv2d layer  with 4 features, high, low, close and volume
        model.add(tf.layers.inputLayer({ inputShape: [nbPeriods, this.nbFeatures], }));
        model.add(tf.layers.conv1d({
            kernelSize: 2,
            filters: 128,
            strides: 1,
            use_bias: true,
            activation: 'relu',
            kernelInitializer: 'VarianceScaling'
        }));
        model.add(tf.layers.averagePooling1d({
            poolSize: [2],
            strides: [1]
        }));
        model.add(tf.layers.conv1d({
            kernelSize: 2,
            filters: 64,
            strides: 1,
            use_bias: true,
            activation: 'relu',
            kernelInitializer: 'VarianceScaling'
        }));
        model.add(tf.layers.averagePooling1d({
            poolSize: [2],
            strides: [1]
        }));
        model.add(tf.layers.flatten());
        model.add(tf.layers.dense({
            units: 1,
            kernelInitializer: 'VarianceScaling',
            activation: 'linear'
        }));

        this.model = model;
        return model;
    }

    compile() {
        const optimizer = tf.train.adam(0.001);
        this.model.compile({
            optimizer: optimizer,
            loss: 'meanSquaredError',
            metrics: ['accuracy']
        });
    }

    // get scale parameters from an array of candles
    findScaleParameters(candles) {
        let scaleParameters = {};
        _.each(candles[0], (v, k) => {
            if (typeof v === 'number') {
                scaleParameters[k] = v;
            }
        });

        _.each(candles, candle => {
            _.each(candle, (v, k) => {
                if (typeof v === 'number' && k != "timestamp") {
                    if (v > scaleParameters[k]) {
                        scaleParameters[k] = v;
                    }
                }
            });
        });

        // apply scale margin
        scaleParameters = _.each(scaleParameters, k => k * this.scaleMargin);
        this.settings.scaleParameters = scaleParameters;
    }

    // return an array of scaled candles, according to previously determined scale factors
    scaleCandles(candles) {
        if (!this.settings.scaleParameters) {
            throw new Error("scale parameters were not loaded");
        }

        let scaledCandles = [];
        _.each(candles, candle => {
            let scaledCandle = _.clone(candle);
            _.each(candle, (v, k) => {
                // if we determined the scale factor for this parameter, apply it
                if (this.settings.scaleParameters[k]) {
                    scaledCandle[k] = v / this.settings.scaleParameters[k];
                } else {
                    scaledCandle[k] = v; // some data are not meant to be scaled (ex: trend)
                }
            });
            scaledCandles.push(scaledCandle);
        });
        return scaledCandles;
    }

    scaleValue(name, value) {
        if (!this.settings.scaleParameters) {
            throw new Error("scale parameters were not loaded");
        }
        if (!this.settings.scaleParameters[name]) {
            throw new Error("scale parameters for " + name + " is not defined");
        }

        return value / this.settings.scaleParameters[name];
    }

    unscaleValue(name, value) {
        if (!this.settings.scaleParameters) {
            throw new Error("scale parameters were not loaded");
        }
        if (!this.settings.scaleParameters[name]) {
            throw new Error("scale parameters for " + name + " is not defined");
        }

        return value * this.settings.scaleParameters[name];
    }

    // return a noramized NN-ready array of input
    getInputArray(candles) {
        // get scaled candles
        let scaledCandles = this.scaleCandles(candles);
        scaledCandles = scaledCandles.slice(scaledCandles.length - this.getNbInputPeriods());

        let arr = [];
        _.each(scaledCandles, (scaledCandle, index) => {
            arr.push([
                //candleVariation.timestamp,
                scaledCandle.close,
                scaledCandle.high,
                scaledCandle.low,
                scaledCandle.volume
            ]);
        });

        return arr;
    }

    // return a noramized NN-ready array of output
    getOutputArray(candle) {
        return [this.scaleValue("close", candle.close)];
    }

    // method to get a input tensor for this model for an input, from periods of btc price
    getInputTensor(candles) {
        let inputs = this.getInputArray(candles);
        return tf.tensor3d([inputs]);
    }

    getTrainData(candles) {
        this.findScaleParameters(candles);

        if (this.trainingOptions.verbose !== 0) {
            console.log('[*] Training model with following settings: ' + JSON.stringify(this.settings, null, 2));
        }

        let nbPeriods = this.getNbInputPeriods();

        let batchInputs = [];
        let batchOutputs = [];

        // build input and output tensors from data
        for (var i = 0; i < candles.length - nbPeriods - 1; i++) {
            // don't train our model on data that doesn't change, it's useless
            if (candles[i + nbPeriods].volume > 0) {
                batchInputs.push(this.getInputArray(candles.slice(i, i + nbPeriods)));
                batchOutputs.push(this.getOutputArray(candles[i + nbPeriods + 1]));
            }
        }

        const inputTensor = tf.tensor3d(batchInputs, [batchInputs.length, nbPeriods, this.nbFeatures], 'float32');
        const outputTensor = tf.tensor2d(batchOutputs, [batchOutputs.length, 1], 'float32');
        return [inputTensor, outputTensor];
    }

    async train(trainCandles) {
        // get price variations
        let [inputTensor, outputTensor] = this.getTrainData(trainCandles);

        if (this.trainingOptions.verbose !== 0) {
            inputTensor.print();
            outputTensor.print();
        }

        // train the model for each tensor
        let options = _.clone(this.trainingOptions);
        options.callbacks = {
            onEpochEnd: async (epoch, logs) => {
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
        // inputTensor.print();

        let outputTensor = this.model.predict(inputTensor);
        let arr = await outputTensor.data();

        // outputTensor.print();
        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        let scaledPrediction = arr[0];
        let prediction = this.unscaleValue('close', scaledPrediction);
        return prediction;
    }

    // if we have more data for our prediction, do a few guesses for the previous
    // values and adjust the prediction with the average loss
    async adjustedPredict(candles) {
        let nbInput = this.getNbInputPeriods();
        let nbGuesses = candles.length - nbInput - 1;
        if (nbGuesses >= 3) {
            nbGuesses = 3; // 3 last prediction is enough
        }

        if (nbGuesses > 0) {
            let losses = [];
            for (let i = 0; i < nbGuesses; i++) {
                let endIndex = candles.length - i - 2;
                let inputCandles = candles.slice(endIndex - nbInput, endIndex);
                let outputCandle = candles[candles.length - i - 1];

                let prediction = await this.predict(inputCandles);
                let realValue = outputCandle.close;

                losses.push(realValue - prediction);
            }

            let avgLoss = _.mean(losses);
            let prediction = await this.predict(candles);
            let adjustedPrediction = prediction + avgLoss;

            // console.log('last:', candles[candles.length - 1].close, 'losses:', JSON.stringify(losses) + ", prediction=", prediction, "adjusted=", adjustedPrediction);
            return adjustedPrediction;
        } else {
            console.warn('Not enough candles to adjust prediction');
            return await this.predict(candles);
        }
    }

    async accuracy(periods) {
        let accuracies = [];
        let nbInconsistencies = 0;
        let errors = [];

        let nbRightTrendPredictions = 0;
        let nbWrongTrendPredictions = 0;

        let currPeriods = periods.slice(0, this.getNbInputPeriods() - 1); // no trades in this area
        for (var i = this.getNbInputPeriods(); i < periods.length - 1; i++) {
            let nextPeriod = periods[i];
            currPeriods.push(nextPeriod);

            let lastValue = periods[i].close;
            let realValue = periods[i + 1].close;
            let prediction = await this.predict(currPeriods);
            let error = prediction - realValue;
            //console.log(`prediction=${prediction.toFixed(0)}€ real=${realValue.toFixed(0)}€ error=${error.toFixed(0)}`);
            if (prediction > realValue * 1.5 || prediction < realValue * 0.75) {
                // inconsistent prediction
                nbInconsistencies++;
            } else {
                if (realValue > lastValue) {
                    // up trend
                    if (prediction > lastValue) {
                        nbRightTrendPredictions++;
                    } else {
                        nbWrongTrendPredictions++;
                    }
                } else if (realValue < lastValue) {
                    if (prediction < lastValue) {
                        nbRightTrendPredictions++;
                    } else {
                        nbWrongTrendPredictions++;
                    }
                }


                let loss = Math.abs(realValue - prediction);
                let acc = 1 - (loss / realValue);
                errors.push(error);
                accuracies.push(acc);
                currPeriods.shift();
            }
        }

        console.log(`Accuracy: min=${_.min(accuracies)} avg=${_.mean(accuracies)} max=${_.max(accuracies)} inconsistencies=${nbInconsistencies / periods.length}`);
        console.log(`Error: min=${_.min(errors)} avg=${_.mean(errors)} max=${_.max(errors)}`);
        console.log(`Trend prediction: right=${nbRightTrendPredictions} wrong=${nbWrongTrendPredictions}`);
    }
}

module.exports = CNNPricePredictionModel;