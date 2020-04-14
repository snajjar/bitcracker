const Trader = require('./trader');
const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const config = require('../../config');
const DensePricePredictionModel = require('../models/prediction/densePricePrediction');

class TraderDensePricePredictX2 extends Trader {
    constructor() {
        super();
    }

    getDescription() {
        return "Try to predict uptrend and downtrends with 2 successive price predictions";
    }

    async initialize(interval) {
        this.model = new DensePricePredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return this.model.getNbInputPeriods() + 1;
    }

    hash() {
        return "ML_DensePredictx2";
    }

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        return await this.model.predict(dataPeriods)
    }

    // get n predictions
    async getPredictions(dataPeriods, n) {
        let periods = _.clone(dataPeriods);
        let predictions = [];
        for (var i = 0; i < n; i++) {
            let predicted = await this.predictPrice(periods);
            predictions.push(predicted);

            periods.shift();
            periods.push({ 'close': predicted }); // push fake dataperiod
        }

        return predictions;
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;


        // get predictions
        let predictions = await this.getPredictions(dataPeriods, 2);
        //console.log("price: " + currentBitcoinPrice + ", predictions: " + predictions);

        // buy condition: 2 successive upward predictions
        let bullish = currentBitcoinPrice < predictions[0] && predictions[0] < predictions[1];

        // sell condition: 2 successive downward predictions
        let bearish = currentBitcoinPrice > predictions[0] && predictions[0] > predictions[1];

        if (!this.inTrade) {
            if (bullish) {
                // BUY condition
                this.buy();
            } else {
                this.hold();
            }
        } else {
            if (bearish) {
                this.sell();
            } else {
                this.hold();
            }
            //this.hold();
        }
    }
}

module.exports = TraderDensePricePredictX2;