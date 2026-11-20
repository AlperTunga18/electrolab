"""Online part-search adapters. Official APIs only, user-supplied keys, never logged or stored."""
import logging

# httpx logs full request URLs at INFO ("HTTP Request: POST <url>"); Mouser's official API
# takes the key as a query parameter, so keep those loggers quiet to never leak it.
for _name in ("httpx", "httpcore"):
    logging.getLogger(_name).setLevel(logging.WARNING)
