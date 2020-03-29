<style>
html,
body {
    height: calc(100vh - 30px);
    background: #0a0224;
    color: white;
    margin: 0;
    padding: 10px;
}

.main {
    height: calc(100vh - 100px);
}

.chart {
    max-width: 100%;
    max-height: calc(100vh - 300px);
    height: calc(100vh - 300px);
}

.tools {
    margin-left: 10px;
    margin-bottom: 20px;
}

.refreshing {
    display: inline-block;
    margin-left: 10px;
}
</style>

<template>
    <div class="main">
        <!--
        <p>
            <router-link to="/foo">Go to Foo</router-link>
            <router-link to="/bar">Go to Bar</router-link>
        </p>
        -->
        <div class="tools">
            <label><i class="fas fa-spinner"></i> Interval:</label>
            <select v-model="intervalStr">
                <option value="1" selected>1m</option>
                <option value="5">5m</option>
                <option value="15">15m</option>
                <option value="30">30m</option>
                <option value="60">1h</option>
                <option value="240">4h</option>
                <option value="1440">1d</option>
                <option value="10080">7d</option>
                <option value="21600">15d</option>
            </select>

            <div class="refreshing" v-if="refreshing">
                <span><i class="fas fa-spinner fa-spin"></i> refreshing...</span>
            </div>
        </div>
        <div class="chart">
            <financial-chart :series="series" :options="chartOptions"></financial-chart>
        </div>
    </div>
</template>

<script>
import $ from "jquery";
import _ from "lodash";
import moment from "moment";
import FinancialChartVue from "./components/charts/FinancialChart.vue";

export default {
    components: {
        "financial-chart": FinancialChartVue
    },
    computed: {
        chartOptions: function() {
            return {
                chart: {
                    type: "candlestick",
                    height: 600
                },
                title: {
                    text: "BTC/EUR last values",
                    align: "left"
                },
                xaxis: {
                    type: "datetime"
                },
                yaxis: {
                    tooltip: {
                        enabled: true
                    }
                }
            };
        },
        interval: function() {
            return parseInt(this.intervalStr, 10);
        },
    },
    created: function() {
        this.currentDataInterval = 1; // last interval for which we fetched data
        this.setRefreshInterval();
    },
    mounted() {
        this.refreshData();
    },
    updated() {
        if( this.currentDataInterval !== this.interval ) {
            this.refreshData();
            this.setRefreshInterval();
        }
    },
    data() {
        return {
            maxCandleDisplay: 100, // number of candle to display
            series: [],
            intervalStr: "1", // in minutes

            refreshing: false,
        };
    },
    methods: {
        setRefreshInterval: function() {
            // update the refresh rate depending on the period
            if( this.refreshInterval !== null ) {
                clearInterval(this.refreshInterval);
            }
            this.refreshInterval = setInterval(() => {
                this.refreshData();
            }, this.interval * 60000);
        },

        secureFetch: function(apiURL) {
            return new Promise((resolve, reject) => {
                const CORSProxy = "https://cors-anywhere.herokuapp.com"; // needed to handle CORS issue
                const url = CORSProxy + "/" + apiURL;
                $.ajax({
                    url: url,
                    type: "GET",
                    dataType: "json",
                    success: function(json) {
                        resolve(json);
                    },
                    error: function(err) {
                        reject(err);
                    },
                    beforeSend: function(xhr) {
                        xhr.setRequestHeader(
                            "X-Requested-With",
                            "XMLHttpRequest"
                        );
                    }
                });
            });
        },

        refreshData: async function() {
            console.log("Refreshing " + moment().format("LLL"));
            this.refreshing = true;
            const apiURL = "https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=" + this.interval;
            const json = await this.secureFetch(apiURL);
            this.refreshing = false;
            const arr = _.get(json, ["result", "XXBTZEUR"]);
            const now = moment();

            // fill the serie with the result from the request
            let serie = [];
            _.each(arr, r => {
                // 1st elem is the date
                let d = moment.unix(r[0]).toDate();

                // check if we wanna display it
                let duration = moment.duration(now.diff(d));
                let minutesDiff = duration.asMinutes();
                if (minutesDiff / this.interval < this.maxCandleDisplay) {
                    // then, get open, high, low and close values
                    let values = [
                        parseFloat(r[1]),
                        parseFloat(r[2]),
                        parseFloat(r[3]),
                        parseFloat(r[4])
                    ];

                    // push result to our array
                    serie.push({ x: d, y: values });
                }
            });

            this.currentDataInterval = this.interval;
            this.series = [{ data: serie }];
        }
    }
};
</script>
