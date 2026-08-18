"""The fixture's product: a tiny ledger."""


def balance(entries):
    return sum(amount for _, amount in entries)


def overdrawn(entries):
    return balance(entries) < 0
