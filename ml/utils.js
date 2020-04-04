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

module.exports = {
    debug,
    sigmoid,
    logit,
    intervals,
    intervalsStr,
    intervalToStr,
    strToInterval,
}