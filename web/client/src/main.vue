<style>
html,
body {
    min-height: 100vh;
    background: #0a0224;
    color: white;
}

.main {
    height: calc(100vh - 42px);
}

.chart {
    max-width: 100%;
    max-height: calc(100vh - 300px);
    height: calc(100vh - 300px);
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
    created: function() {},
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
        }
    },
    mounted() {
        this.refreshData();

        // refresh every minute
        setInterval(() => {
            this.refreshData();
        }, 60000);
    },
    data() {
        return {
            maxCandleDisplay: 80, // number of candle to display
            series: []
        };
    },
    methods: {
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
                    error: function() {
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
            const apiURL =
                "https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=1";
            const json = await this.secureFetch(apiURL);
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
                if (minutesDiff < this.maxCandleDisplay) {
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

            this.series = [{ data: serie }];
        }
    }
};
</script>
