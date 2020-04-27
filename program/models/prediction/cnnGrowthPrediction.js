/******************************************************************************
 * simple dense model to predict btc price
 *****************************************************************************/

const Model = require('../model');
const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const dt = require('../../lib/datatools');

class CNNTrendPredictionModel extends Model {
    constructor() {
        super();
        this.trainingOptions = {
            shuffle: true,
            epochs: 10000,
            batchsize: 1440,
            verbose: 1,
        }

        this.nbFeatures = 25;
        this.settings.nbInputPeriods = 8;
    }

    // uniq model name - usefull for save & load
    getName() {
        return "CNNGrowthPrediction";
    }

    // nb candles to train/predict for this model
    getNbInputPeriods() {
        // we want to predict trends from the last nbInputPeriods candles based on OHLC data for different intervals: 1m, 5m, 15m, 30m, 1h
        // so we need at least nbInputPeriods * 60
        return this.settings.nbInputPeriods * 60;
    }

    // asynchronous initialization can't be done in the constructor
    async initialize() {

    }

    createModel() {
        const nbPeriods = this.settings.nbInputPeriods;

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
            filters: 32,
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
        model.add(tf.layers.dense({ units: 8 }));
        model.add(tf.layers.dense({
            units: 1,
            kernelInitializer: 'VarianceScaling',
            activation: 'relu'
        }));

        this.model = model;
        return model;
    }

    compile() {
        const optimizer = tf.train.adam(0.01);
        this.model.compile({
            optimizer: optimizer,
            loss: 'meanSquaredError',
            metrics: ['accuracy']
        });
    }

    // get scale parameters from an array of candles
    findScaleParameters(candles) {
        let scaleParameters = _.clone(this.settings.scaleParameters || {});
        _.each(candles[0], (v, k) => {
            if (typeof v === 'number' && k != "timestamp" && !scaleParameters[k]) {
                scaleParameters[k] = {
                    min: v,
                    max: v,
                }
            }
        });

        _.each(candles, candle => {
            _.each(candle, (v, k) => {
                if (typeof v === 'number' && k != "timestamp") {
                    if (v > scaleParameters[k].max) {
                        scaleParameters[k].max = v;
                    }
                    if (v < scaleParameters[k].min) {
                        scaleParameters[k].min = v;
                    }
                }
            });
        });

        //scaleParameters = _.each(scaleParameters, k => k * this.scaleMargin);
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
                    scaledCandle[k] = this.scaleValue(k, v);
                } else {
                    scaledCandle[k] = v; // some data are not meant to be scaled (ex: trend)
                }
            });
            scaledCandle.normalized = true;
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

        let scale = this.settings.scaleParameters[name];
        return (value - scale.min) / (scale.max - scale.min); // minmax normalisation
    }

    unscaleValue(name, value) {
        if (!this.settings.scaleParameters) {
            throw new Error("scale parameters were not loaded");
        }
        if (!this.settings.scaleParameters[name]) {
            throw new Error("scale parameters for " + name + " is not defined");
        }

        let scale = this.settings.scaleParameters[name];
        return value * (scale.max - scale.min) + scale.min;
    }

    // merge candles n by n
    mergeCandlesBy(candles, n) {
        if (candles.length % n !== 0) {
            throw new Error("Error while merging candles: " + candles.length + " cant be divided by " + n);
        }

        let merged = [];
        let chunks = _.chunk(candles, n);
        _.each(chunks, chunk => {
            let c = dt.mergeCandles(chunk);
            merged.push(c);
        });
        return merged;
    }

    // return a noramized NN-ready array of input
    getInputArray(candles, scaled = false) {
        candles = candles.slice(candles.length - this.getNbInputPeriods());

        // extract array for each time period
        let scaledCandles1m = candles;
        let scaledCandles5m = this.mergeCandlesBy(candles, 5);
        let scaledCandles15m = this.mergeCandlesBy(candles, 15);
        let scaledCandles30m = this.mergeCandlesBy(candles, 30);
        let scaledCandles1h = this.mergeCandlesBy(candles, 60);

        // now get the nbPeriods last candles for each time period
        let input1m = scaledCandles1m.slice(scaledCandles1m.length - this.settings.nbInputPeriods);
        let input5m = scaledCandles5m.slice(scaledCandles5m.length - this.settings.nbInputPeriods);
        let input15m = scaledCandles15m.slice(scaledCandles15m.length - this.settings.nbInputPeriods);
        let input30m = scaledCandles30m.slice(scaledCandles30m.length - this.settings.nbInputPeriods);
        let input1h = scaledCandles1h.slice(scaledCandles1h.length - this.settings.nbInputPeriods);

        let arr = [];
        for (let i = 0; i < this.settings.nbInputPeriods; i++) {
            // push every information for every time period
            // group them so it my be easier to detect patterns
            arr.push([
                input1m[i].open,
                input5m[i].open,
                input15m[i].open,
                input30m[i].open,
                input1h[i].open,
                input1m[i].high,
                input5m[i].high,
                input15m[i].high,
                input30m[i].high,
                input1h[i].high,
                input1m[i].low,
                input5m[i].low,
                input15m[i].low,
                input30m[i].low,
                input1h[i].low,
                input1m[i].close,
                input5m[i].close,
                input15m[i].close,
                input30m[i].close,
                input1h[i].close,
                input1m[i].volume,
                input5m[i].volume,
                input15m[i].volume,
                input30m[i].volume,
                input1h[i].volume,
            ])
        }

        return arr;
    }

    getOutputArray(candle) {
        if (!candle.normalized) {
            throw new Error('getOutputArray should only work with normalized candles');
        }

        return [candle.trendFactor];
    }

    // method to get a input tensor for this model for an input, from periods of btc price
    getInputTensor(candles) {
        let inputs = this.getInputArray(candles);
        return tf.tensor3d([inputs]);
    }

    getTrainData(candles) {
        if (this.trainingOptions.verbose !== 0) {
            console.log('[*] Training model with following settings: ' + JSON.stringify(this.settings, null, 2));
        }

        let nbPeriods = this.getNbInputPeriods();

        let batchInputs = [];
        let batchOutputs = [];

        // build input and output tensors from data
        for (var i = 0; i < candles.length - nbPeriods; i++) {
            let currCandle = candles[i + nbPeriods];
            if (currCandle.trendFactor) {
                batchInputs.push(this.getInputArray(candles.slice(i, i + nbPeriods)));
                batchOutputs.push(this.getOutputArray(currCandle));
            }
        }

        console.log(`[*] Training on ${batchInputs.length} samples`);
        const inputTensor = tf.tensor3d(batchInputs, [batchInputs.length, this.settings.nbInputPeriods, this.nbFeatures], 'float32');
        const outputTensor = tf.tensor2d(batchOutputs, [batchOutputs.length, 1], 'float32');
        return [inputTensor, outputTensor];
    }

    async train(trainCandles) {
        console.log("[*] Model training starting.");
        console.log("[*] Preparing train data...");

        // add our trend labels
        trainCandles = dt.labelTrendsValues(trainCandles);

        //  find scale parameters on the 1h period (for volumes to be right)
        this.findScaleParameters(trainCandles);
        // also, find scale parameters on 1h period, so because volumes are added in there
        let candles1h = this.mergeCandlesBy(trainCandles.slice(0, trainCandles.length - trainCandles.length % 60), 60);
        this.findScaleParameters(candles1h);
        let scaledCandles = this.scaleCandles(trainCandles);

        // get price variations
        let [inputTensor, outputTensor] = this.getTrainData(scaledCandles);

        if (this.trainingOptions.verbose !== 0) {
            inputTensor.print();
            outputTensor.print();
        }

        // train the model for each tensor
        let options = _.clone(this.trainingOptions);
        options.callbacks = {
            onEpochEnd: async (epoch, logs) => {
                // if (epoch % 10 == 0) {
                //     await this.accuracy(trainCandles.splice(0, 21000)); // show acc on 2 first weeks
                // }
                await this.save();
            },
        }
        await this.model.fit(inputTensor, outputTensor, options);

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);
    }


    async trainLowMemory(candles) {
        console.log("[*] Model low-memory training starting.");
        console.log("[*] Preparing train data...");

        // label data with uptrends of 1% and downtrends of 1%
        dt.labelTrendsValues(candles);

        //  find scale parameters on the 1h period (for volumes to be right)
        this.findScaleParameters(candles);
        // also, find scale parameters on 1h period, so because volumes are added in there
        let candles1h = this.mergeCandlesBy(candles.slice(0, candles.length - candles.length % 60), 60);
        this.findScaleParameters(candles1h);

        let scaledCandles = this.scaleCandles(candles);

        // prepare our training options
        let options = _.clone(this.trainingOptions);
        options.callbacks = {
            onEpochEnd: async (epoch, logs) => {
                console.log(`[*] Trained with: ${nbLabels.up} up, ${nbLabels.down} down, ${nbLabels.still} still`);
                // if (epoch % 10 == 0) {
                //     await this.accuracy(candles)
                // }
                await this.save();
            },
        }

        if (this.trainingOptions.verbose !== 0) {
            console.log('[*] Training model with following settings: ' + JSON.stringify(this.settings, null, 2));
        }

        // data generator (inputs)
        const nbPeriods = this.getNbInputPeriods();
        let self = this;
        let data = function*() {
            for (let i = 0; i < scaledCandles.length - nbPeriods; i++) {
                let curr = scaledCandles[i + nbPeriods];
                if (curr.trendFactor) {
                    yield self.getInputArray(scaledCandles.slice(i, i + nbPeriods));
                }
            }
        }

        // label generator (outputs)
        let nbLabels = { "up": 0, "still": 0, "down": 0 };
        let label = function*() {
            for (let i = 0; i < scaledCandles.length - nbPeriods; i++) {
                let curr = scaledCandles[i + nbPeriods];
                if (curr.trendFactor) {
                    yield self.getOutputArray(curr);
                }
            }
        }

        const xs = tf.data.generator(data);
        const ys = tf.data.generator(label);

        // We zip the data and labels together, shuffle and batch it according to training options defined.
        let ds = tf.data.zip({ xs, ys });
        if (options.shuffle) {
            // since we are oversamling, we NEED to shuffle.
            // this will make tf create in advance 10k values
            // and shuffle the array at every new sample
            ds = ds.shuffle(1000, null, true);
        }
        ds = ds.batch(options.batchsize);

        await this.model.fitDataset(ds, options);
    }

    async predict(candles) {
        let scaledCandles = this.scaleCandles(candles);
        let inputCandles = scaledCandles.slice(scaledCandles.length - this.getNbInputPeriods());
        let inputTensor = this.getInputTensor(inputCandles);
        // inputTensor.print();

        let outputTensor = this.model.predict(inputTensor);
        let arr = await outputTensor.data();

        // outputTensor.print();
        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        let growthPrediction = this.unscaleValue("trendFactor", arr[0]);
        return growthPrediction;
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
                let realValue = this.unscaleValue("trendFactor", outputCandle.trendFactor);

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

    // display confusion matrix
    async accuracy(candles, adjusted = false) {
        console.log(`[*] computing accuracy with adjusted=${adjusted}`);

        // label data with uptrends of 1% and downtrends of 1%
        dt.labelTrendsValues(candles);

        let matrix = {
            "predicted_up": { "up": 0, "still": 0, "down": 0 },
            "predicted_still": { "up": 0, "still": 0, "down": 0 },
            "predicted_down": { "up": 0, "still": 0, "down": 0 }
        };

        let currCandles;
        if (adjusted) {
            currCandles = candles.slice(0, this.getNbInputPeriods() + 3); // no trades in this area
        } else {
            currCandles = candles.slice(0, this.getNbInputPeriods() - 1); // no trades in this area
        }
        for (var i = this.getNbInputPeriods(); i < candles.length - 1; i++) {
            let nextCandle = candles[i];
            currCandles.push(nextCandle);

            let trend = null;
            let trendFactor = candles[i].trendFactor;
            if (trendFactor) {
                if (trendFactor == 1) {
                    trend = "still";
                } else if (trendFactor < 1) {
                    trend = "down";
                } else if (trendFactor > 1) {
                    trend = "up";
                }

                let prediction;
                if (adjusted) {
                    prediction = await this.adjustedPredict(currCandles);
                } else {
                    prediction = await this.predict(currCandles);
                }

                let predictedTrend = null;
                if (prediction == 1) {
                    predictedTrend = "still";
                } else if (prediction < 1) {
                    predictedTrend = "down";
                } else if (prediction > 1) {
                    predictedTrend = "up";
                } else {
                    console.log('prediction: ' + prediction);
                }

                matrix["predicted_" + predictedTrend][trend]++;
                currCandles.shift();
            }
        }

        console.log('[*] Confusion matrix');
        console.table(matrix);
    }
}

module.exports = CNNTrendPredictionModel;