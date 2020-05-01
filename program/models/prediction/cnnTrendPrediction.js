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
            batchsize: 288,
            verbose: 1,
            learningRate: 0.1,
        }

        // adaptatively change the learning rate during training, if we're stuck

        this.learningRateCycle = [];

        this.learningRateIndex = 0;
        this.bestAcc = -1;
        this.bestLoss = +Infinity;
        this.optimizer = null;

        this.uptrendTreshold = 0.01;
        this.downtrendTreshold = 0.01;
        this.nbWindows = 5;
        this.nbFeatures = 5;
        this.settings.nbInputPeriods = 8;

        this.scaleMargin = 1.1; // 1.2: we can go 20% higher than the higher value
    }

    generateLearningCycle(start, end, step) {
        this.learningRateCycle = [];
        for (var i = start; i < end; i += step) {
            let val = i > 0 ? Math.round(i * 1000) / 1000 : 0.001; // avoid 0
            this.learningRateCycle.push(val);
        }
        for (var i = end; i >= start; i -= step) {
            let val = i > 0 ? Math.round(i * 1000) / 1000 : 0.001; // avoid 0
            this.learningRateCycle.push(val);
        }
    }

    // uniq model name - usefull for save & load
    getName() {
        return "CNNTrendPrediction";
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


        model.add(tf.layers.inputLayer({ inputShape: [nbPeriods, this.nbFeatures, this.nbWindows], }));
        model.add(tf.layers.batchNormalization({}));
        model.add(tf.layers.conv2d({
            kernelSize: 2,
            filters: 8,
            strides: 1,
            use_bias: true,
            activation: 'relu',
            kernelInitializer: 'VarianceScaling'
        }));
        model.add(tf.layers.averagePooling2d({
            poolSize: [1, 2],
            strides: [1, 1]
        }));
        model.add(tf.layers.batchNormalization({}));
        model.add(tf.layers.conv2d({
            kernelSize: 2,
            filters: 32,
            strides: 1,
            use_bias: true,
            activation: 'relu',
            kernelInitializer: 'VarianceScaling'
        }));
        model.add(tf.layers.averagePooling2d({
            poolSize: [1, 2],
            strides: [1, 1]
        }));
        model.add(tf.layers.batchNormalization({}));
        model.add(tf.layers.conv2d({
            kernelSize: 2,
            filters: 512,
            strides: 1,
            use_bias: true,
            activation: 'relu',
            kernelInitializer: 'VarianceScaling'
        }));
        model.add(tf.layers.flatten());
        model.add(tf.layers.dense({
            units: 3,
            kernelInitializer: 'VarianceScaling',
            activation: 'softmax'
        }));

        this.model = model;
        return model;
    }

    compile() {
        // 0, 1, 0.01 for adam, 0, 2, 0.1 for SGD
        //this.generateLearningCycle(0, 2, 0.2);
        // this.optimizer = tf.train.sgd(this.trainingOptions.learningRate);
        //this.optimizer = tf.train.adadelta(0.01);
        this.optimizer = tf.train.momentum(0.01, 0.01);
        this.model.compile({
            optimizer: this.optimizer,
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });
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
        let scaledCandles = this.scaleCandles(candles);

        // extract array for each time period
        let scaledCandles1m = scaledCandles;
        let scaledCandles5m = this.mergeCandlesBy(scaledCandles, 5);
        let scaledCandles15m = this.mergeCandlesBy(scaledCandles, 15);
        let scaledCandles30m = this.mergeCandlesBy(scaledCandles, 30);
        let scaledCandles1h = this.mergeCandlesBy(scaledCandles, 60);

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
                [
                    input1m[i].open,
                    input5m[i].open,
                    input15m[i].open,
                    input30m[i].open,
                    input1h[i].open,
                ],
                [
                    input1m[i].high,
                    input5m[i].high,
                    input15m[i].high,
                    input30m[i].high,
                    input1h[i].high,
                ],
                [
                    input1m[i].low,
                    input5m[i].low,
                    input15m[i].low,
                    input30m[i].low,
                    input1h[i].low,
                ],
                [
                    input1m[i].close,
                    input5m[i].close,
                    input15m[i].close,
                    input30m[i].close,
                    input1h[i].close,
                ],
                [
                    input1m[i].volume,
                    input5m[i].volume,
                    input15m[i].volume,
                    input30m[i].volume,
                    input1h[i].volume,
                ]
            ])
        }

        return arr;
    }

    // return a noramized NN-ready array of output
    getOutputArray(candle) {
        if (candle.trend == "down") {
            return [1, 0, 0];
        } else if (candle.trend == "up") {
            return [0, 1, 0];
        } else if (candle.trend == "still" || !candle.trend) {
            return [0, 0, 1];
        }
    }

    // method to get a input tensor for this model for an input, from periods of btc price
    getInputTensor(candles) {
        let inputs = this.getInputArray(candles);
        return tf.tensor4d([inputs]);
    }

    getTrainData(candles) {
        // add our trend labels
        candles = dt.labelTrends(candles, this.uptrendTreshold, this.downtrendTreshold);

        if (this.trainingOptions.verbose !== 0) {
            console.log('[*] Training model with following settings: ' + JSON.stringify(this.settings, null, 2));
        }

        let nbPeriods = this.getNbInputPeriods();

        let batchInputs = [];
        let batchOutputs = [];

        // make sure we add the same number of data from each class (undersampling)
        let nbUp = 0;
        let nbDown = 0;
        let nbStill = 0;

        // build input and output tensors from data
        for (var i = 0; i < candles.length - nbPeriods - 1; i++) {
            let currCandle = candles[i + nbPeriods];
            let nextCandle = candles[i + nbPeriods + 1];

            // filter out candles that are no volume, no movement here
            if (currCandle.volume > 0) {

                let add = false;
                if (nextCandle.trend == "up") {
                    nbUp++;
                    add = true;
                } else if (nextCandle.trend == "down") {
                    nbDown++;
                    add = true;
                } else if (nextCandle.trend == "still" || !nextCandle.trend) {
                    if (nbStill < nbUp || nbStill < nbDown) {
                        // don't add necessary the next one, we have plenty of choice
                        if (Math.random() < 0.01) {
                            add = true;
                            nbStill++;
                        }
                    }
                }

                // adapt training set to ratios
                if (add) {
                    batchInputs.push(this.getInputArray(candles.slice(i, i + nbPeriods)));
                    batchOutputs.push(this.getOutputArray(nextCandle));
                }
            }
        }

        const inputTensor = tf.tensor4d(batchInputs, [batchInputs.length, this.settings.nbInputPeriods, this.nbFeatures], 'float32');
        const outputTensor = tf.tensor2d(batchOutputs, [batchOutputs.length, 3], 'float32');
        return [inputTensor, outputTensor];
    }

    getOversamplingRatios(candles) {
        let classCounts = _.countBy(candles, 'trend');

        // determine ratios for oversampling, we want to have ~ the same number of
        // uptrends, downtrends and still in the training model
        let oversamplingRatios = {
            "up": Math.floor(classCounts.still / classCounts.up),
            "down": Math.floor(classCounts.still / classCounts.down),
            "still": 1
        }
        console.log('Oversampling: ' + JSON.stringify(oversamplingRatios, null, 2));
        return oversamplingRatios;
    }

    async train(trainCandles) {
        console.log("[*] Model training starting.");
        console.log("[*] Preparing train data...");

        //  find scale parameters on the 1h period (for volumes to be right)
        this.findScaleParameters(trainCandles);
        // also, find scale parameters on 1h period, so because volumes are added in there
        let candles1h = this.mergeCandlesBy(trainCandles.slice(0, trainCandles.length - trainCandles.length % 60), 60);
        this.findScaleParameters(candles1h);
        let scaledCandles = this.scaleCandles(trainCandles);

        // determine ratios for oversampling, we want to have ~ the same number of
        // uptrends, downtrends and still in the training model
        let oversamplingRatios = this.getOversamplingRatios(scaledCandles);

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
            // Attach some class weight for our model to be more attentive to certain classes
            classWeight: [oversamplingRatios["down"], oversamplingRatios["up"], 1]
        }
        await this.model.fit(inputTensor, outputTensor, options);

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);
    }

    setLearningRate(v) {
        // only developped for SGD for now
        if (this.optimizer.setLearningRate) {
            this.optimizer.setLearningRate(v);
            return true;
        } else {
            this.optimizer.learningRate = v;
            return false;
        }
    }

    randomizeLearningRate() {
        this.learningRateIndex = (this.learningRateIndex + Math.floor(Math.random() * 10)) % this.learningRateCycle.length;
        let newLR = this.learningRateCycle[this.learningRateIndex];
        this.setLearningRate(newLR);
    }

    // change the learning rate according to the Cyclical Learning Rate method (for super convergence)
    cycleLearningRate() {
        this.learningRateIndex = (this.learningRateIndex + 1) % this.learningRateCycle.length;
        let newLR = this.learningRateCycle[this.learningRateIndex];
        console.log("[*] Setting learning rate to: ", newLR);
        this.setLearningRate(newLR);
    }

    async trainLowMemory(candles) {
        console.log("[*] Model low-memory training starting.");
        console.log("[*] Preparing train data...");

        // label data with uptrends of 1% and downtrends of 1%
        dt.labelTrends(candles, this.uptrendTreshold, this.downtrendTreshold);

        //  find scale parameters on the 1h period (for volumes to be right)
        this.findScaleParameters(candles);
        // also, find scale parameters on 1h period, so because volumes are added in there
        let candles1h = this.mergeCandlesBy(candles.slice(0, candles.length - candles.length % 60), 60);
        this.findScaleParameters(candles1h);

        let scaledCandles = this.scaleCandles(candles);

        // determine ratios for oversampling, we want to have ~ the same number of
        // uptrends, downtrends and still in the training model
        let oversamplingRatios = this.getOversamplingRatios(scaledCandles);

        // prepare our training options
        let options = _.clone(this.trainingOptions);
        options.callbacks = {
            onEpochEnd: async (epoch, logs) => {
                if (epoch % 5 == 0) {
                    await this.accuracy(candles.slice(0, 1440 * 7))
                }

                let acc = logs.acc;
                if (acc > this.bestAcc) {
                    this.bestAcc = acc;
                    console.log(`[*] Best accuracy so far: ${(this.bestAcc*100).toFixed(3)}%`);
                    console.log('[*] saving model');
                    await this.save();
                }

                // ensure it's not always the same batches that get the same learning rate
                //this.cycleLearningRate();
            },
            onBatchEnd: async (batch, logs) => {},
            // Attach some class weight for our model to be more attentive to certain classes
            classWeight: [oversamplingRatios["down"], oversamplingRatios["up"], 1]
        }

        if (this.trainingOptions.verbose !== 0) {
            console.log('[*] Training model with following settings: ' + JSON.stringify(this.settings, null, 2));
        }

        let splitIndex = Math.floor(scaledCandles.length * 0.80); // 80-20 train/test data split
        let trainingDataset = this.getDataset(scaledCandles, 0, splitIndex, options);
        let testingDataset = this.getDataset(scaledCandles, splitIndex, scaledCandles.length, options);
        options.validationData = testingDataset;
        await this.model.fitDataset(trainingDataset, options);
    }

    getDataset(scaledCandles, startIndex, stopIndex, options) {
        let trainingCandles = scaledCandles.slice(startIndex, stopIndex);

        // data generator (inputs)
        const nbPeriods = this.getNbInputPeriods();
        let self = this;
        let data = function*() {
            for (let i = 0; i < trainingCandles.length - nbPeriods; i++) {
                yield self.getInputArray(trainingCandles.slice(i, i + nbPeriods));
            }
        }

        // label generator (outputs)
        let label = function*() {
            for (let i = 0; i < trainingCandles.length - nbPeriods; i++) {
                let curr = trainingCandles[i + nbPeriods];
                yield self.getOutputArray(curr);
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
            ds = ds.shuffle(50000, null, true);
        }
        ds = ds.batch(options.batchsize);
        return ds;
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

        let max = _.max(arr);
        let maxIndex = arr.indexOf(max);
        switch (maxIndex) {
            case 0:
                return { trend: "down", probability: arr[maxIndex] };
            case 1:
                return { trend: "up", probability: arr[maxIndex] };
            case 2:
                return { trend: "still", probability: arr[maxIndex] };
            default:
                console.log(arr);
                throw new Error("Unkown value for maxIndex: " + maxIndex);
        }
    }

    // display confusion matrix
    async accuracy(candles) {
        // label data with uptrends of 1% and downtrends of 1%
        dt.labelTrends(candles, this.uptrendTreshold, this.downtrendTreshold);

        let matrix = {
            "predicted_up": { "up": 0, "still": 0, "down": 0 },
            "predicted_still": { "up": 0, "still": 0, "down": 0 },
            "predicted_down": { "up": 0, "still": 0, "down": 0 }
        };

        let currCandles = candles.slice(0, this.getNbInputPeriods() - 1); // no trades in this area
        for (var i = this.getNbInputPeriods(); i < candles.length - 1; i++) {
            let nextCandle = candles[i];
            currCandles.push(nextCandle);

            let trend = candles[i].trend;
            // console.log(candles[i]);
            let prediction = await this.predict(currCandles);

            // if (trend == "up") {
            //     console.log(`trend=up, prediction=${prediction.trend}, p=${prediction.probability}`);
            // }

            matrix["predicted_" + prediction.trend][trend]++;

            currCandles.shift();
        }

        console.log('[*] Confusion matrix');
        console.table(matrix);
    }
}

module.exports = CNNTrendPredictionModel;