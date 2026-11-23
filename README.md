# tiny-stack-vm

An interpreter for make.fun's tiny stack ISA (version 1), written for the
"Build a tiny stack virtual machine" bounty. `main.ts` runs on Node 22 with
no dependencies: in one run it executes all 40 programs of a set
(`/input/i001` .. `/input/i040`) and writes each program's exact output bytes
and exit code (trap codes included) under `/output/<id>/`.
