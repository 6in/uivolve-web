# Progress

## turn 1 — research — OPFS転送の標準API・既存境界・異常系を調査
- やったこと: similar_oss / official_docs / local_projectsを調査し、RESEARCH.mdへ参考パス・URL、統合変更点、容量/排他/中止/確定/進捗の検証基準を記録した。要件変更を要する重大発見はなくplanへ遷移する。
- 想定外: 既存ResourceClientの本文は約1 MBのUint8Array限定、Web Locksは競合時待機であり、そのまま転送には使えない。lean-ctx構成ツールはapproval policyで拒否され、読み取りで継続した。最初のloopスクリプト推定パス、コード推定パスは不一致。lean-ctx readはプロジェクト外パスを拒否するため通常readでローカル参考を確認した。
- やり直し: 3 回（loopをPATH上のgsd-lite-loop.shに修正、コード検索パスを実在パスへ修正、プロジェクト外の参考readを通常ツールへ変更）。
- 次への注意: --whereの出力はmode=repo、MS=.gsd-lite、TARGET=.。loopはPATH上のgsd-lite-loop.shを使う。コードパスはsrc/adapters/http.js / src/file-client.js。プロジェクト外readは通常ツールで行う。転送専用本文経路、共有BUSY排他、実promiseのcleanupまでのロック保持をplanに含め、RESEARCHの検証表を完了基準へ写す。
