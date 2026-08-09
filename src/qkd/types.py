"""Shared type aliases.

Kept in one place so that the protocol modules and the metrics module cannot
drift apart on what a "sequence of bits" is.
"""

from collections.abc import Sequence

Bits = Sequence[int]
"""An ordered sequence of bit values, each 0 or 1.

The 0/1 constraint is not expressible in the type system: it is enforced at
runtime by the validators, and stated in the docstring of every function that
takes one.
"""

Bases = Sequence[int]
"""An ordered sequence of basis choices, each 0 (rectilinear) or 1 (diagonal).

The encoding convention is fixed and documented in `bb84.prepare`.
"""
