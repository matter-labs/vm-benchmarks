const util = require('util');
const exec = util.promisify(require('child_process').exec);

function process_VMTrace(statistic, trace)
{
    let code = trace.code.slice(2);
    for (const op of trace.ops) {
        let curOpcode = code.slice(op.pc * 2, op.pc * 2 + 2);
        statistic.sum_of_op_costs += op.cost;
        if (curOpcode == "55"){ // SSTORE
            statistic.stored_values.push([op.ex.store.key, op.ex.store.val]);
        }

        statistic.opcodes_histogram.set(curOpcode, (statistic.opcodes_histogram.get(curOpcode) || 0) + 1);

        if (op.sub){
            process_VMTrace(statistic, op.sub);
        }
    }

    return statistic;
}

export async function get_analytics_for_transaction(nodeUrl, txHash)
{
    let statistic = {
        number_of_calls: 0,
        calls_input_sizes: [],
        opcodes_histogram: new Map(),
        stored_values: [],
        sum_of_op_costs: 0
    };

    let requestToNode = 'curl --data \'{"method":"trace_replayTransaction","params":["' + txHash + '",["stateDiff", "vmTrace", "trace"]],"id":1,"jsonrpc":"2.0"}\' -H "Content-Type: application/json" -X POST ' + nodeUrl;
    // console.log(requestToNode);
    let ten_MB_buffer = 10 * 1024 * 1024;
    const { stdout, stderr } = await exec(requestToNode, {maxBuffer: ten_MB_buffer});

    let trace = JSON.parse(stdout);

    process_VMTrace(statistic, trace.result.vmTrace);

    for (let i=0; i<trace.result.trace.length; i++){
        const callType = trace.result.trace[i].action.callType;
        if (callType == "call" || callType == "staticcall"){
            statistic.number_of_calls++;
        }

        if (trace.result.trace[i].action.input) {
            statistic.calls_input_sizes.push((trace.result.trace[i].action.input.length - 2) / 2);
        }
    }

    return statistic;
}
