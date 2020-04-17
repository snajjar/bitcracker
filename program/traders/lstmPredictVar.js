const Trader = require('./trader');
const _ = require('lodash');
const config = require('../config');
const LSTMPriceVariationPredictionModel = require('../models/prediction/lstmPriceVariationPrediction');

class TraderLTSMPredictVar extends Trader {
    constructor() {
        super();
    }

    getDescription() {
        return "Try to speculate on bitcoin variations from a LSTM neural network trained to predict prices variations";
    }

    async initialize() {
        this.model = new LSTMPriceVariationPredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return this.model.getNbInputPeriods() + 1;
    }

    hash() {
        return "ML_LSTMPredictVar";
    }

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        return await this.model.predict(dataPeriods);
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // get predictions
        let prediction = await this.predictPrice(dataPeriods);
        let bullish = prediction > currentBitcoinPrice;
        let bearish = prediction < currentBitcoinPrice;

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

module.exports = TraderLTSMPredictVar;