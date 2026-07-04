from src.utils.math import add


class TestAdd:
    def test_adds_two_positive_numbers(self):
        assert add(2, 3) == 5

    def test_handles_negative_numbers(self):
        assert add(-2, 3) == 1

    def test_handles_zero(self):
        assert add(0, 5) == 5
