/******************************************************************************
 * simple dense model to predict btc price
 *****************************************************************************/

const Model = require('../model');
const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const datatools = require('../../lib/datatools');
const config = require('../../config');

class CNNPriceVariationPredictionModel extends Model {
    constructor() {
        super();
        this.trainingOptions = {
            shuffle: true,
            epochs: 10,
            batchsize: 10,
        }

        // cap maximum variance per period to improve neural net's accuracy
        this.maxVariancePerPeriod = 0.01;
    }

    // uniq model name - usefull for save & load
    getName() {
        return "CNNPriceVariationPrediction";
    }

    // nb candles to train/predict for this model
    getNbInputPeriods() {
        return 16; // for variations computation
    }

    // asynchronous initialization can't be done in the constructor
    async initialize() {

    }

    createModel() {
        const nbPeriods = this.getNbInputPeriods();

        let model = tf.sequential();

        // add a conv2d layer
        model.add(tf.layers.inputLayer({ inputShape: [nbPeriods, 3], }));
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
        const optimizer = tf.train.adam(0.002);
        this.model.compile({
            optimizer: optimizer,
            loss: 'meanSquaredError',
            metrics: ['accuracy']
        });
    }

    getInputArray(candles) {
        // get variations
        let candleVariations = datatools.dataVariations(candles, this.maxVariancePerPeriod);
        candleVariations = candleVariations.slice(candles.length - this.getNbInputPeriods());

        let arr = [];
        _.each(candleVariations, (candleVariation, index) => {
            arr.push([
                //candleVariation.timestamp,
                this.activateVariation(candleVariation.close),
                this.activateVariation(candleVariation.high),
                this.activateVariation(candleVariation.low)
            ]);
        });

        return arr;
    }

    getOutputArray(candle) {
        return [this.activateVariation(candle.close)];
    }

    // method to get a input tensor for this model for an input, from periods of btc price
    getInputTensor(candles) {
        let inputs = this.getInputArray(candles);
        return tf.tensor3d([inputs]);
    }

    getOutputTensor(candle) {
        let outputs = this.getOutputArray(candle);
        return tf.tensor2d([outputs]);
    }

    // variation is between [1-maxVariance, 1+maxVariance], map this to [0, 1]
    activateVariation(x) {
        return (x + this.maxVariancePerPeriod - 1) / (2 * this.maxVariancePerPeriod);
    }

    // output is between [0, 1], map this to [1-maxVariance, 1+maxVariance]
    deactivateVariation(x) {
        return x * 2 * this.maxVariancePerPeriod + 1 - this.maxVariancePerPeriod;
    }

    getTrainData(candles) {
        let nbPeriods = this.getNbInputPeriods();
        let batchInputs = [];
        let batchOutputs = [];

        // build input and output tensors from data
        for (var i = 0; i < candles.length - nbPeriods - 1; i++) {
            // only push actual price variations to the model, otherwise it sucks
            // we really don't care about predicting no movement
            let outputCloseVar = candles[i + nbPeriods + 1].close;
            if (outputCloseVar !== 1) {
                batchInputs.push(this.getInputArray(candles.slice(i, i + nbPeriods)));
                batchOutputs.push(this.getOutputArray(candles[i + nbPeriods + 1]));
            }
        }

        const inputTensor = tf.tensor3d(batchInputs, [batchInputs.length, nbPeriods, 3], 'float32');
        const outputTensor = tf.tensor2d(batchOutputs, [batchOutputs.length, 1], 'float32');
        return [inputTensor, outputTensor];
    }

    async train(trainCandles, testCandles = null) {
        let trainingSet = trainCandles;

        // get price variations
        let candleVariations = datatools.dataVariations(trainingSet, this.maxVariancePerPeriod);

        let [inputTensor, outputTensor] = this.getTrainData(candleVariations);

        inputTensor.print();
        outputTensor.print();

        // train the model for each tensor
        let options = _.clone(this.trainingOptions);
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

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        let predictedVariation = this.deactivateVariation(arr[0]);
        let predictedPrice = candles[candles.length - 1].close * predictedVariation;
        return predictedPrice;
    }

    async accuracy(periods) {
        let accuracies = [];
        let losses = [];
        let nbInconsistencies = 0;

        let currPeriods = periods.slice(0, this.getNbInputPeriods() - 1); // no trades in this area
        for (var i = this.getNbInputPeriods(); i < periods.length - 1; i++) {
            let nextPeriod = periods[i];
            currPeriods.push(nextPeriod);

            let realValue = periods[i + 1].close;
            let prediction = await this.predict(currPeriods);
            let error = realValue - prediction;
            //console.log(`prediction=${prediction.toFixed(0)}€ real=${realValue.toFixed(0)}€ error=${error.toFixed(0)}`);
            if (prediction > realValue * 1.5 || prediction < realValue * 0.75) {
                // inconsistent prediction
                nbInconsistencies++;
            } else {
                let loss = Math.abs(realValue - prediction);
                let acc = 1 - (loss / realValue);
                losses.push(loss);
                accuracies.push(acc);
                currPeriods.shift();
            }
        }

        console.log(`Accuracy: min=${_.min(accuracies)} avg=${_.mean(accuracies)} max=${_.max(accuracies)} inconsistencies=${nbInconsistencies / periods.length}`);
    }
}

module.exports = CNNPriceVariationPredictionModel;