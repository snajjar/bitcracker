const Trader = require('./trader');
const _ = require('lodash');
const config = require('../../config');
const DensePriceVariationPredictionModel = require('../models/prediction/densePriceVariationPrediction');

class TraderDensePredictVar extends Trader {
    constructor() {
        super();
    }

    getDescription() {
        return "Try to speculate on bitcoin variations from a dense neural network trained to predict prices variations";
    }

    async initialize(interval) {
        this.model = new DensePriceVariationPredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return this.model.getNbInputPeriods() + 1;
    }

    hash() {
        return "ML_DensePredictVar";
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
        let variationPrediction = await this.predictPrice(dataPeriods);
        let bullish = variationPrediction > 1;

        // sell condition: 2 successive downward predictions
        let bearish = variationPrediction < 1;

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

module.exports = TraderDensePredictVar;