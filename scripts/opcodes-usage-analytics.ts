import {ArgumentParser} from "argparse";

const get_analytics_for_transaction = require('../src.ts/opcodes-usage-analytics-utils').get_analytics_for_transaction;

var fs = require('fs');


function isEthereumAddress(hex_value)
{
    return false; /// :(
}

function minimumBytesToEncodeMantisa(hex_value)
{
    // TODO
    return Math.ceil((hex_value.length - 2) / 2)
}

function minimumBytesToEncodeSSTORE(key, value)
{
    let encodeKeyBytes = 33;
    if (parseInt(key)<128) {
        encodeKeyBytes = 1;
    } else if (isEthereumAddress(key)) {
        encodeKeyBytes = 5;
    } else {
        encodeKeyBytes = 1 + minimumBytesToEncodeMantisa(key);
    }

    let encodeValueBytes = 33;
    // As we can't here calculate diff with previously stored value
    // we would just encode value
    if (parseInt(value)<128) {
        encodeValueBytes = 1;
    } else {
        encodeValueBytes = 1 + minimumBytesToEncodeMantisa(value);
    }

    return encodeKeyBytes + encodeValueBytes;
}

async function main()
{
    /*
        just run next commands

        yarn install
        yarn opcodes-usage-analytics --nodeUrl ... --txHashes h1,h2,h3
        yarn opcodes-usage-analytics --nodeUrl ... --blockId 112233

        as nodeUrl can be used https://white-bitter-breeze.quiknode.pro/a53ae019bc2182e0a144c51f8c04a2d6687cecb6/
        if this not works find another one

        !!!!! FOR LAST 15-minutes block use https://damp-nameless-star.quiknode.pro/2325ca979d1d392813588dbe45ee90c293b03cf7/
        https://old-summer-snow.quiknode.pro/6d8caca935e0d827cbd4374472816789d55096da/
        https://silent-weathered-glade.quiknode.pro/eada7406e79b5d0b29f91de2c7f89a9135036d0e/
    */

    const ETHEREUM_PRICE = 400;
    const GAS_PRICE_WEI = 300 * 1e9;

    const parser = new ArgumentParser({
        version: "0.1.0",
        addHelp: true,
        description: "Opcodes usage script",
    });
    parser.addArgument("--nodeUrl", { required: true, help: "node url" });
    parser.addArgument("--txHashes", { required: false, help: "tx hashes" });
    parser.addArgument("--blockId", { required: false, help: "block id" });
    const args = parser.parseArgs(process.argv.slice(2));
    let nodeUrl = args.nodeUrl;
    var Eth = require('web3-eth');
    var eth = new Eth(nodeUrl);

    let txHashes = args.txHashes ? args.txHashes.split(',') : (await eth.getBlock(args.blockId)).transactions;

    for (const txHash of txHashes){
        let statistic = await get_analytics_for_transaction(nodeUrl, txHash);
        // console.log(statistic);


        let opcodes_cost = JSON.parse(fs.readFileSync("opcodes_cost.txt"));
        let transactionSummaryInfo = {
            N_ONCHAIN_BYTES: 0,
            N_SLOAD: 0,
            N_SSTORE: 0,
            N_CYCLES: 0,
            N_CALLS: 0,
            UNSUPPORTED: 0
        };

        let logOnchainBytes = 0;
        const digits = String('0123456789abcdef');
        for (const d1 of digits){
            for (const d2 of digits){
                let curOpcodeCost = opcodes_cost["0x" + d1 + d2];
                let occurrencesInTransaction = statistic.opcodes_histogram.get(d1+d2);
                if (curOpcodeCost && occurrencesInTransaction){
                    if (d1=="a"){ // logOnchainBytes
                        logOnchainBytes += occurrencesInTransaction * curOpcodeCost.N_ONCHAIN_BYTES;
                    } else {
                        transactionSummaryInfo.N_ONCHAIN_BYTES += occurrencesInTransaction * curOpcodeCost.N_ONCHAIN_BYTES;
                        transactionSummaryInfo.N_SLOAD += occurrencesInTransaction * curOpcodeCost.N_SLOAD;
                        transactionSummaryInfo.N_SSTORE += occurrencesInTransaction * curOpcodeCost.N_SSTORE;
                        transactionSummaryInfo.N_CYCLES += occurrencesInTransaction * curOpcodeCost.N_CYCLES;
                        transactionSummaryInfo.N_CALLS += occurrencesInTransaction * curOpcodeCost.N_CALLS;
                        transactionSummaryInfo.UNSUPPORTED += occurrencesInTransaction * curOpcodeCost.UNSUPPORTED;
                    }
                }
            }
        }
        // SSTORE impact to N_ONCHAIN_BYTES
        for (const [key, value] of statistic.stored_values){
            transactionSummaryInfo.N_ONCHAIN_BYTES += minimumBytesToEncodeSSTORE(key,value);
        }

        // console.log("----------------");
        // console.log("logOnchainBytes ::", logOnchainBytes);
        // console.log("transactionSummaryInfo");
        // console.log(transactionSummaryInfo);
        // console.log("----------------");
        // console.log("AVERAGE ONCHAIN BYTES PER SSTORE ::",
        //     transactionSummaryInfo.N_ONCHAIN_BYTES / transactionSummaryInfo.N_SSTORE
        // );

        let MIN_AGGREGATED_GATES = 1e100;
        let MIN_FPGA_TIME = 1e100;
        let MIN_FPGA_COST = 1e100;
        let MIN_CPU_COST = 1e100;

        for (const GATES_PER_CYCLE of [1000, 500]){
            for (const FPGA_PERFORMANCE of [8_000_000, 12_500_000]){
                for (const CPU_PERFORMANCE of [125_000]){
                    let ONCHAIN_BYTES = transactionSummaryInfo.N_ONCHAIN_BYTES;
                    let GAS_COST = ONCHAIN_BYTES * 18;

                    const MAX_CONTRACT_LENGTH = 2_000;
                    const N_CALLS_MAX = 16;

                    let CALL_GATES_SLOAD = 40_000 * transactionSummaryInfo.N_SLOAD;
                    let CALL_GATES_SSTORE = 80_000 * transactionSummaryInfo.N_SSTORE;
                    let CALL_GATES_CYCLES = 2 * GATES_PER_CYCLE * transactionSummaryInfo.N_CYCLES;
                    let CALL_GATES_CONTRACTS_UNPACKING = 250 * (MAX_CONTRACT_LENGTH / 2) * N_CALLS_MAX;
                    let CALL_GATES_SUMMARY = CALL_GATES_SLOAD + CALL_GATES_SSTORE + CALL_GATES_CYCLES + CALL_GATES_CONTRACTS_UNPACKING;

                    let AGGREGATED_GATES = 4_000_000 * 1 + CALL_GATES_SUMMARY + 80_000 * transactionSummaryInfo.N_CALLS;

                    let FPGA_TIME = 13.0 * AGGREGATED_GATES / FPGA_PERFORMANCE;
                    let FPGA_COST_USD = 1.5 * FPGA_TIME / 3600;

                    let CPU_TIME = 13 * AGGREGATED_GATES / CPU_PERFORMANCE;
                    let CPU_COST_USD = 0.8 * CPU_TIME / 3600 / 16;

                    // console.log("");
                    // console.log("--------------------------------------------------------------");
                    // console.log("CALL_GATES_SLOAD: ", CALL_GATES_SLOAD/1e6, "M");
                    // console.log("CALL_GATES_SSTORE: ", CALL_GATES_SSTORE/1e6, "M");
                    // console.log("CALL_GATES_CYCLES: ", CALL_GATES_CYCLES/1e6, "M");
                    // console.log("CALL_GATES_CONTRACTS_UNPACKING: ", CALL_GATES_CONTRACTS_UNPACKING/1e6, "M");
                    // console.log("CALL_GATES_SUMMARY: ", CALL_GATES_SUMMARY/1e6, "M");
                    // console.log("AGGREGATED_GATES: ", AGGREGATED_GATES/1e6, "M");
                    // console.log("N_CYCLES: ", transactionSummaryInfo.N_CYCLES);
                    // console.log("  GATES_PER_CYCLE: ", GATES_PER_CYCLE);
                    // console.log("  FPGA_PERFORMANCE: ", FPGA_PERFORMANCE);
                    // console.log("  CPU_PERFORMANCE: ", CPU_PERFORMANCE);
                    // console.log("------------- AS RESULT -------------");
                    // console.log("GAS_COST: ", GAS_COST);
                    // console.log("----- FPGA -----");
                    // console.log("  FPGA_TIME: ", FPGA_TIME, "s");
                    // console.log("  FPGA_COST in USD: ", FPGA_COST_USD);
                    // console.log("----- CPU -----");
                    // console.log("  CPU_TIME: ", CPU_TIME, "s");
                    // console.log("  CPU_COST in USD: ", CPU_COST_USD);
                    // console.log("--------------------------------------------------------------");

                    MIN_AGGREGATED_GATES=Math.min(MIN_AGGREGATED_GATES, AGGREGATED_GATES);
                    MIN_FPGA_TIME=Math.min(MIN_FPGA_TIME, FPGA_TIME);
                    MIN_FPGA_COST=Math.min(MIN_FPGA_COST, FPGA_COST_USD);
                    MIN_CPU_COST=Math.min(MIN_CPU_COST, CPU_COST_USD);
                }
            }
        }
        let TOTAL_USED_GAS = parseInt((await eth.getTransactionReceipt(txHash)).gasUsed);

        let CSV = "";
        CSV += "\"" + "https://etherscan.io/tx/" + txHash + "\"";
        CSV += ";" + statistic.calls_input_sizes[0];
        CSV += ";" + statistic.calls_input_sizes[0]*18;
        CSV += ";" + "$" + statistic.calls_input_sizes[0]*18 * GAS_PRICE_WEI / 1e18 * ETHEREUM_PRICE;
        CSV += ";" + TOTAL_USED_GAS;
        CSV += ";" + GAS_PRICE_WEI / 1e9;
        CSV += ";" + "$" + TOTAL_USED_GAS * GAS_PRICE_WEI / 1e18 * ETHEREUM_PRICE;
        CSV += ";" + transactionSummaryInfo.N_SSTORE;
        CSV += ";" + transactionSummaryInfo.N_ONCHAIN_BYTES;
        CSV += ";" + transactionSummaryInfo.N_ONCHAIN_BYTES*18;
        CSV += ";" + "$" + transactionSummaryInfo.N_ONCHAIN_BYTES*18 * GAS_PRICE_WEI / 1e18 * ETHEREUM_PRICE;
        CSV += ";" + MIN_AGGREGATED_GATES;
        CSV += ";" + MIN_FPGA_TIME;
        CSV += ";" + "$" + MIN_FPGA_COST;
        CSV += ";" + "$" + ((transactionSummaryInfo.N_ONCHAIN_BYTES*18 * GAS_PRICE_WEI / 1e18 * ETHEREUM_PRICE) + (MIN_FPGA_COST));
        CSV += ";" + "$" + MIN_CPU_COST;
        console.log(CSV);
    }
}

main();
