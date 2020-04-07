const k = 10000; // for sigmoid with larger numbers
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
        throw "unrecognized time setting: " + interval;
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

var displayTraders = async function(arr) {
    let toDisplay = arr.slice(0, Math.min(arr.length, 5));
    for (var i = 0; i < toDisplay.length; i++) {
        let t = toDisplay[i];
        let hash = await t.hash();
        console.log(`    Trader #${t.number} (${hash}):`);
        console.log(`       gain: ${t.gainStr()} win/loss: ${t.winLossRatioStr()} avg ROI: ${t.avgROIStr()}`);
        console.log(`      ${t.statisticsStr()}`);
        console.log(`      ${t.tradesStr()}`);
    }
}

var saveTraders = async function(arr, interval) {
    for (var j = 0; j < arr.length; j++) {
        let t = await NeuroTrader.clone(arr[j]);
        await t.model.save(`file://./models/neuroevolution/generation/Cex_BTCEUR_${utils.intervalToStr(interval)}_Top${j}/`);
    }
}

module.exports = {
    debug,
    sigmoid,
    logit,
    intervals,
    intervalsStr,
    intervalToStr,
    strToInterval,
    displayTraders,
    saveTraders
}