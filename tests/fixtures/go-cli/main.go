// Command greet is the fixture's product: a minimal CLI with a testable core.
package main

import (
	"flag"
	"fmt"
	"strings"
)

func greeting(name string, shout bool) string {
	msg := "hello, " + name
	if shout {
		msg = strings.ToUpper(msg)
	}
	return msg
}

func main() {
	shout := flag.Bool("shout", false, "print the greeting in capitals")
	flag.Parse()
	name := "world"
	if flag.NArg() > 0 {
		name = flag.Arg(0)
	}
	fmt.Println(greeting(name, *shout))
}
