/******************************************************************************
 * densePricePrediction.js - simple dense model to predict btc price
 *****************************************************************************/

const Model = require('../model');
const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const datatools = require('../../lib/datatools');
const config = require('../../config');

class DensePriceTrendPredictionModel extends Model {
    constructor() {
        super();
        this.trainingOptions = {
            shuffle: true,
            epochs: 3,
            batchsize: 10,
        }

        this.uptrendTreshold = 0.01;
        this.downtrendTreshold = 0.01;

        // cap maximum variance per period to improve neural net's accuracy
        this.maxVariancePerPeriod = 0.01;
    }

    // uniq model name - usefull for save & load
    getName() {
        return "DensePriceVariationPrediction";
    }

    // nb candles to train/predict for this model
    getNbInputPeriods() {
        return 5; // for variations computation
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
                tf.layers.dense({ units: 3, activation: 'softmax' }),
            ]
        });
    }

    compile() {
        const optimizer = tf.train.sgd(0.1);
        this.model.compile({
            optimizer: optimizer,
            loss: 'categoricalCrossentropy',
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

    async train(trainCandles) {
        // label data with uptrends of 1% and downtrends of 1%
        let trainingSet = datatools.labelTrends(trainCandles, this.uptrendTreshold, this.downtrendTreshold);

        let inputs = [];
        let outputs = [];
        let nbPeriods = this.getNbInputPeriods();

        // get price variations
        let candleVariations = datatools.dataVariations(trainingSet, this.maxVariancePerPeriod);

        let nbStill = 0;
        let nbUp = 0;
        let nbDown = 0;

        // build input and output tensors from data
        for (var i = 0; i < candleVariations.length - nbPeriods - 2; i++) {
            // compute the input field from the first nbPeriods periods
            let sampleInputs = [];
            for (var j = 0; j < nbPeriods; j++) {
                let closePrice = candleVariations[i + j].close;
                sampleInputs.push(this.activateVariation(closePrice));
            }
            inputs.push(sampleInputs);

            // compute the output field with from the next period
            let trend = candleVariations[i + nbPeriods].trend;
            if (trend == "still" || !trend) {
                outputs.push([1, 0, 0]);
                nbStill++;
            } else if (trend == "up") {
                outputs.push([0, 1, 0]);
                nbUp++;
            } else if (trend == "down") {
                outputs.push([0, 0, 1]);
                nbDown++;
            }
        }

        console.log(`  - Trends in dataset: ${nbStill} still, ${nbUp} up, ${nbDown} down`);

        // now, we got our sample, but we're like for increasing the model performance to work on the variations of theses data
        let nbSamples = outputs.length;

        // build our tensors
        const nbDataInput = this.getNbInputPeriods();
        let inputTensor = tf.tensor2d(inputs, [nbSamples, nbDataInput], 'float32');
        let outputTensor = tf.tensor2d(outputs, [nbSamples, 3], 'float32');

        inputTensor.print();
        outputTensor.print();

        // train the model for each tensor
        let options = _.clone(this.trainingOptions);
        options.callbacks = {
            onEpochEnd: async (epoch, logs) => {
                // VERY BAD IDEA: if we save like this, the model is not "finalized"
                // meaning it can still output underteminitic results....
                // await this.save();
            }
        }
        await this.model.fit(inputTensor, outputTensor, options);

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);
    }

    async predict(candles) {
        let inputCandles = candles;
        if (inputCandles.length !== this.getNbInputPeriods()) {
            console.warn('warning, number of input given for prediction is larger than required');
            inputCandles = candles.slice(inputCandles.length - this.getNbInputPeriods());
        }

        let inputTensor = this.getInputTensor(inputCandles);

        let outputTensor = this.model.predict(inputTensor);
        let arr = await outputTensor.data();

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        // console.log('predicted: ' + JSON.stringify(arr));

        let maxTrend = _.max(arr);
        if (arr.indexOf(maxTrend) == 0) {
            return "still";
        } else if (arr.indexOf(maxTrend) == 1) {
            return "up";
        } else if (arr.indexOf(maxTrend) == 2) {
            return "down";
        } else {
            throw "unknown error while reading prediction";
        }
    }

    async accuracy(periods) {
        // label data with uptrends of 1% and downtrends of 1%
        datatools.labelTrends(periods, this.uptrendTreshold, this.downtrendTreshold);

        // let testPeriods = periods.slice(0, this.getNbInputPeriods());
        // let prediction = await this.predict(testPeriods);
        // console.log('testPeriods:');
        // console.log(JSON.stringify(testPeriods, null, 2));
        // console.log('prediction: ' + prediction);

        let nbUpTrend = 0;
        let nbPredictedUpTrend = 0;
        let nbRightUpTrend = 0;
        let nbMissedUpTrend = 0;
        let nbWrongUpTrend = 0;

        let nbDownTrend = 0;
        let nbPredictedDownTrend = 0;
        let nbRightDownTrend = 0;
        let nbMissedDownTrend = 0;
        let nbWrongDownTrend = 0;

        let nbStillTrend = 0;
        let nbPredictedStillTrend = 0;
        let nbRightStillTrend = 0;
        let nbMissedStillTrend = 0;
        let nbWrongStillTrend = 0;

        let currPeriods = periods.slice(0, this.getNbInputPeriods() - 1); // no trades in this area
        for (var i = this.getNbInputPeriods(); i < periods.length - 1; i++) {
            let nextPeriod = periods[i];
            currPeriods.push(nextPeriod);

            let trend = periods[i].trend;
            let predictedTrend = await this.predict(currPeriods);

            if ("up" == trend) {
                nbUpTrend++;
            } else if ("down" == trend) {
                nbDownTrend++;
            } else {
                nbStillTrend++;
            }

            if ("up" == predictedTrend) {
                nbPredictedUpTrend++;
            } else if ("down" == predictedTrend) {
                nbPredictedDownTrend++;
            } else {
                nbPredictedStillTrend++;
            }

            if (trend == "up") {
                switch (predictedTrend) {
                    case "up":
                        nbRightUpTrend++;
                        break;
                    case "down":
                        nbMissedUpTrend++;
                        nbWrongDownTrend++;
                        break;
                    case "still":
                        nbMissedUpTrend++;
                        break;
                    default:
                        throw new Error("Predicted: " + predictedTrend);
                }
            } else if (trend == "down") {
                switch (predictedTrend) {
                    case "down":
                        nbRightDownTrend++;
                        break;
                    case "up":
                        nbMissedDownTrend++;
                        nbWrongUpTrend++;
                        break;
                    case "still":
                        nbMissedDownTrend++;
                        break;
                    default:
                        throw new Error("Predicted: " + predictedTrend);
                }
            } else if (trend == "still") {
                switch (predictedTrend) {
                    case "still":
                        nbRightStillTrend++;
                        break;
                    case "up":
                        nbMissedStillTrend++;
                        nbWrongUpTrend++;
                        break;
                    case "down":
                        nbMissedStillTrend++;
                        nbWrongDownTrend++;
                        break;
                    default:
                        throw new Error("Predicted: " + predictedTrend);
                }
            }

            currPeriods.shift();
        }

        console.log(`Uptrends:   real=${nbUpTrend} predicted=${nbPredictedUpTrend} right=${nbRightUpTrend} wrong=${nbWrongUpTrend} missed=${nbMissedUpTrend}`);
        console.log(`DownTrends: real=${nbDownTrend} predicted=${nbPredictedDownTrend} right=${nbRightDownTrend} wrong=${nbWrongDownTrend} missed=${nbMissedDownTrend}`);
        console.log(`Still:      real=${nbStillTrend} predicted=${nbPredictedStillTrend} right=${nbRightStillTrend} wrong=${nbWrongStillTrend} missed=${nbMissedStillTrend}`);
    }
}

module.exports = DensePriceTrendPredictionModel;