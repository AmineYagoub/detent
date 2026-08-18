package main

import "testing"

func TestGreeting(t *testing.T) {
	if got := greeting("detent", false); got != "hello, detent" {
		t.Fatalf("greeting = %q", got)
	}
}

func TestGreetingShouts(t *testing.T) {
	if got := greeting("detent", true); got != "HELLO, DETENT" {
		t.Fatalf("shouted greeting = %q", got)
	}
}
