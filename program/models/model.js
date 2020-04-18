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
}

module.exports = Model;