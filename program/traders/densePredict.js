const Trader = require('./trader');
const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const DensePricePredictionModel = require('../models/prediction/densePricePrediction');

class TraderDense extends Trader {
    constructor() {
        super();
    }

    async initialize(interval) {
        this.model = new DensePricePredictionModel();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return this.model.getNbInputPeriods();
    }

    hash() {
        return "ML_DensePredict";
    }

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        return await this.model.predict(dataPeriods)
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // get predictions
        let prediction = await this.predictPrice(dataPeriods);

        // buy condition: 2 successive upward predictions
        let bullish = currentBitcoinPrice < prediction;

        // sell condition: 2 successive downward predictions
        let bearish = currentBitcoinPrice > prediction;

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
        }
    }
}

module.exports = TraderDense;