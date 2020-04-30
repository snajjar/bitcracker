/******************************************************************************
 * model.js - root class for a tensorflow.js model
 *****************************************************************************/
const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('../lib/utils');
const fs = require('fs-extra');
const config = require('../config');
let path = require('path');

class Model {
    constructor() {
        this.model = null;

        // this object will be saved and loaded with the model by model.load()
        // or be initialized by model.train()
        this.settings = {
            nbInputPeriods: null, // to be redefined by the inherited class
            scaleParameters: null,
        };
    }

    // asynchronous initialization can't be done in the constructor
    async initialize() {
        throw "to be redefined";
    }

    // uniq model name - usefull for save & load
    getName() {
        throw "to be redefined";
    }

    // nb candles to train/predict for this model
    getNbInputPeriods() {
        throw "to be redefined";
    }

    compile() {
        throw "to be redefined";
    }

    // return a tf.model object
    getModel() {
        return this.model;
    }

    // method to get a input tensor for this model for an input, from periods of btc price
    getInputTensor(candles) {
        throw "to be redefined";
    }

    // method to get a input tensor for this model, from periods of btc price
    getOuputTensor(candles) {
        throw "to be redefined";
    }

    // testCandles are optional
    async train(trainCandles, testCandles) {
        throw "to be redefined";
    }

    async predict(candles) {
        throw "to be redefined";
    }

    // expected to end with '/'
    path() {
        let interval = config.getInterval();
        let intervalStr = utils.intervalToStr(interval);
        return `./models/saved/supervised/${this.getName()}/Cex_BTCEUR_${intervalStr}/`;
    }

    async save() {
        fs.ensureDirSync(this.path());
        fs.writeFileSync(this.path() + "settings.json", JSON.stringify(this.settings, null, 2));
        return await this.model.save('file://' + this.path());
    }

    async load() {
        this.settings = require(path.join("../", this.path(), "settings.json"));
        console.log('[*] Loading model settings: ' + JSON.stringify(this.settings, null, 2));
        this.model = await tf.loadLayersModel(`file://${this.path()}/model.json`);
    }

    async accuracy(periods) {
        throw "to be redefined";
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
            if (!candle.normalized) {
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
            } else {
                scaledCandles.push(_.clone(candle));
            }
        });
        return scaledCandles;
    }

    // normalize utils
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
}

module.exports = Model;