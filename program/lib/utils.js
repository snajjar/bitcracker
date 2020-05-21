const k = 1; // for sigmoid with larger numbers
const sigmoid = function(x) {
    return 1 / (1 + Math.exp(-x / k));
}

const logit = function(x) {
    return k * Math.log(x / (1 - x));
}

const intervalsStr = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"];
const intervals = [1, 5, 15, 30, 60, 240, 1440, 10080, 21600];

const intervalToStr = function(interval) {
    if (!intervals.includes(interval)) {
        throw new Error("unrecognized time setting: " + interval);
    } else {
        let index = intervals.indexOf(interval);
        return intervalsStr[index];
    }
}

const strToInterval = function(str) {
    if (!intervalsStr.includes(str)) {
        throw "unrecognized time setting: " + str;
    } else {
        let index = intervalsStr.indexOf(str);
        return intervals[index];
    }
}

const debug = function(o) {
    console.log(require('util').inspect(o));
}

var displayTrader = async function(t) {
    let hash = await t.hash();
    let s = t.statisticsColoredStr();
    let trades = s.trades;
    console.log(`    Trader #${t.number} (${hash}):`);
    console.log(`      gain: ${s.cumulatedGain} win/loss: ${s.winLossRatio} avg ROI: ${s.avgROI} lowest balance: ${s.lowestBalance}`);
    console.log(`      ${trades.nbTrades} trades, ${trades.nbPositiveTrades} won, ${trades.nbNegativeTrades} lost, ${trades.nbStopLoss} stop loss, ${trades.nbTakeProfit} take profit`);
    console.log(`      ${trades.nbBuy} buy, ${trades.nbSell} sell, ${trades.nbBid} bid, ${trades.nbAsk} ask, ${trades.nbHold} hold (${trades.nbHoldIn} in, ${trades.nbHoldOut} out)`);

    t.s.displayDetails();
}

var displayTraders = async function(arr) {
    let toDisplay = arr.slice(0, Math.min(arr.length, 5));
    for (var i = 0; i < toDisplay.length; i++) {
        let t = toDisplay[i];
        await displayTrader(t);
    }
}

var displayTraderByTaxes = async function(t) {

}


module.exports = {
    debug,
    sigmoid,
    logit,
    intervals,
    intervalsStr,
    intervalToStr,
    strToInterval,
    displayTrader,
    displayTraders,
}