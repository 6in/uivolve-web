fn init(s) {s}
fn send(s, request) {
    rpc_call(request, #{name:s.name, sequenceId:"9007199254740993", payload:"AH+A/w=="});
    s.loading=true; s.message="通信しています…"; s
}
fn connect(s,e) {send(s,"connectEcho")}
fn grpc(s,e) {send(s,"grpcEcho")}
fn echoDone(s,r) {
    s.loading=false;
    if r.ok {
        s.message=r.data.name;
        s.details=r.request + " / int64: " + r.data.sequenceId + " / bytes: " + r.data.payload;
    } else {s.message="失敗: " + r.error; s.details="";}
    s
}
