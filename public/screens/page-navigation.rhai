fn init(state) { state }

fn openDetails(state, event) {
    navigate("details");
    state
}

fn tryMissingPage(state, event) {
    navigate("missing");
    state
}
