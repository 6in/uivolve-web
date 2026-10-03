fn initial_cards() {
    [
        #{ id: "task-1", title: "画面を設計", description: "YAMLで構成する", lane: "todo" },
        #{ id: "task-2", title: "Rhaiを書く", description: "移動時の処理を追加", lane: "todo" },
        #{ id: "task-3", title: "入力を確認", description: "日本語も試す", lane: "doing" },
        #{ id: "task-4", title: "テーマを選ぶ", description: "両方の描画へ反映", lane: "doing" },
    ]
}

fn init(state) {
    state.cards = initial_cards();
    state
}

fn cardMoved(state, event) {
    // The engine has already moved the card in a tentative copy of state.
    // Throwing rolls back the card, its order, and all changes from this handler.
    if state.reviewRequired && event.value == "done" {
        throw "完了への移動はレビュー待ちです。元の位置を保持しました。";
    }
    state.moves += 1;
    let destination = switch event.value {
        "todo" => "未着手",
        "doing" => "進行中",
        "done" => "完了",
    };
    state.notice = `${event.id} → ${destination}（移動 ${state.moves} 回）`;
    state
}

fn resetBoard(state, event) {
    state.cards = initial_cards();
    state.moves = 0;
    state.reviewRequired = false;
    state.notice = "初期状態に戻しました。完了の空の列にもドロップできます。";
    state
}
