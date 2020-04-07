const _ = require('lodash');
const colors = require('colors');

const startingFunding = 1000;
const buyTax = 0.0026;
const sellTax = 0.0016;

class Trader {
    static count = 0;

    constructor() {
        this.number = Trader.count++;

        // wallet and score values
        this.btcWallet = 0;
        this.eurWallet = startingFunding;
        this.lastBitcoinprice = 0; // keep last bitcoin price for score computations

        // statistics utils
        this.nbPenalties = 0;
        this.lastBuyPrice = 0;
        this.trades = [];
        this.nbBuy = 0;
        this.nbSell = 0;
        this.nbHold = 0;
    }

    resetTrading() {
        this.btcWallet = 0;
        this.eurWallet = 1000;
    }

    resetStatistics() {
        this.nbPenalties = 0;
        this.lastBuyPrice = 0;
        this.trades = [];
        this.nbBuy = 0;
        this.nbSell = 0;
        this.nbHold = 0;
    }

    statisticsStr() {
        let positiveTrades = _.filter(this.trades, v => v > 1);
        let negativeTrades = _.filter(this.trades, v => v < 1);

        return `${this.trades.length} trades, ${positiveTrades.length} won, ${negativeTrades.length} lost, ${this.nbPenalties} penalities, ${((this.totalROI())*100).toFixed(2) + "%"} result`;
    }

    tradesStr() {
        return `${this.nbBuy} buy, ${this.nbSell} sell, ${this.nbHold} hold`;
    }

    hasEuros() {
        return this.eurWaller > 0 ? 1 : 0;
    }

    hasBitcoins() {
        return this.btcWallet > 0 ? 1 : 0;
    }

    async action(lastPeriods, currentBitcoinPrice) {
        throw "TO BE REDEFINED";
    }

    gain() {
        return (this.eurWallet + this.btcWallet * this.lastBitcoinprice) - startingFunding;
    }

    gainStr() {
        let gain = this.gain();
        let gainStr = `${gain.toFixed(0)}€`;
        return gain > 0 ? gainStr.green : gainStr.red;
    }

    totalROI() {
        return _.reduce(this.trades, (a, b) => a * b) || 1;
    }

    avgROI() {
        return _.meanBy(this.trades) || 0; // return 0 if no trades done
    }

    avgROIStr() {
        let avgROI = this.avgROI();
        let avgStr = (this.avgROI() * 100).toFixed(2) + "%";
        return avgROI > 1 ? avgStr.green : avgStr.red;
    }

    winLossRatio() {
        let wins = 0;
        let losses = 0;
        _.each(this.trades, r => {
            if (r > 1 + buyTax + sellTax) {
                wins++;
            } else {
                losses++;
            }
        });
        let nbTrades = this.trades.length;

        return nbTrades > 0 ? wins / nbTrades : 0; // ensure it's not null
    }

    winLossRatioStr() {
        let wl = this.winLossRatio();
        let wlStr = this.winLossRatio().toFixed(0.2);
        return wl > 0.5 ? wlStr.green : wlStr.red;
    }

    score() {
        // score is the global ROI of the trader
        // add the buy/sell tax into account
        return this.gain();
    }

    addTrade(oldBitcoinPrice, newBitcoinPrice) {
        this.trades.push(newBitcoinPrice / oldBitcoinPrice);
    }

    buy(currentBitcoinPrice) {
        this.nbBuy++;
        if (this.eurWallet > 0) {
            this.btcWallet += (this.eurWallet * (1 - buyTax)) / currentBitcoinPrice;
            this.eurWallet = 0;
            this.lastBuyPrice = currentBitcoinPrice;
            return "BUY";
        } else {
            this.nbPenalties++; // cant buy, have no money
            return "";
        }

        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to BUY at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    sell(currentBitcoinPrice) {
        this.nbSell++;
        if (this.btcWallet > 0) {
            this.eurWallet += (this.btcWallet * (1 - sellTax)) * currentBitcoinPrice;
            this.btcWallet = 0;

            // add last trade statistics
            this.addTrade(this.lastBuyPrice, currentBitcoinPrice);
            return "SELL";
        } else {
            this.nbPenalties++;
            return "";
        }

        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to SELL at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    hold(currentBitcoinPrice) {
        // doing nothing is what i do best
        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to HOLD at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
        this.nbHold++;
        return "HOLD";
    }

    checkNotNaN() {
        if (isNaN(this.score())) {
            this.debug();
            process.exit(-1);
        }
    }

    debug() {
        console.log(`Trader #${this.number} debug:`);
        console.log('  eurWallet: ' + this.eurWallet);
        console.log('  btcWallet: ' + this.btcWallet);
        console.log('  bitcoin price: ' + this.lastBitcoinPrice);
    }

    dispose() {
        this.model.dispose();
    }
}

module.exports = Trader;