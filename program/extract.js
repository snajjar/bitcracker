/******************************************************************************
 * extract.js - extract and adjust data for different granularities
 *****************************************************************************/

const csv = require('./lib/csv');
const utils = require('./lib/utils');
const _ = require('lodash');
const moment = require('moment');
const dt = require('./lib/datatools');

// debug
const hasNaN = function(o) {
    let hasNaN = false;
    _.each(o, (v) => {
        if (isNaN(v)) {
            hasNaN = true;
            return false;
        }
    });
    return hasNaN;
}

// jump from interval to interval, and merge all data in it
const convertToInterval = function(data, interval) {
    let samples = [];
    let samplesToMerge = [data[0]];
    let lastDate = moment.unix(data[0].timestamp);
    let nextDate = moment.unix(data[0].timestamp).add(5, 'minutes');

    //console.log(`merging data from ${lastDate.format('YYYY-MM-DD hh:mm')} to ${nextDate.format('YYYY-MM-DD hh:mm')}`);

    let index = 1;
    while (data[index]) {
        let sample = data[index];

        if (!moment.unix(sample.timestamp).isAfter(nextDate)) {
            //console.log(`    sample found: ${moment.unix(sample.timestamp).format('YYYY-MM-DD HH:MM')}`);
            // if (hasNaN(sample)) {
            //     console.error('Sample with NaN values found at index: ' + index);
            //     console.log(sample);
            //     process.exit(-1);
            // }
            samplesToMerge.push(sample);
            index++;
        } else {
            if (samplesToMerge.length) {
                samples.push(dt.mergeCandles(samplesToMerge, lastDate));
            } else {
                // no new data during that interval, get from previous data
                let lastSample = _.clone(samples[samples.length - 1]);
                samples.push({
                    "timestamp": lastDate.unix(),
                    "open": lastSample.close,
                    "high": lastSample.close,
                    "low": lastSample.close,
                    "close": lastSample.close,
                    "volume": 0
                });

                // if (hasNaN(lastSample)) {
                //     console.error('Pushed nan at index: ' + index);
                //     console.log(sample);
                //     process.exit(-1);
                // }
            }

            // increase time and reset array
            samplesToMerge = [];
            lastDate.add(interval, 'minutes');
            nextDate.add(interval, 'minutes');
            //console.log(`merging data from ${lastDate.format('YYYY-MM-DD hh:mm')} to ${nextDate.format('YYYY-MM-DD hh:mm')}`);
        }
    }

    // remove the very last element, so we ensure that we don't have an "unfinished" sample
    samples.pop();

    dt.connectCandles(samples);
    return samples;
}

var extract = async function(interval) {
    console.log(`[*] Extracting data for interval ${utils.intervalToStr(interval)}`);
    let data1m = await csv.getFileData('./data/Cex_BTCEUR_1m.csv');
    let cleanedData = dt.removePriceAnomalies(data1m)
    let data = convertToInterval(cleanedData, interval);
    await csv.setFileData(`./data/Cex_BTCEUR_${utils.intervalToStr(interval)}_Refined.csv`, data);
}

module.exports = extract;