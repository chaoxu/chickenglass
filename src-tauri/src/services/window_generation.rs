pub fn accepts_generation(existing_generation: Option<u64>, incoming_generation: u64) -> bool {
    !matches!(existing_generation, Some(existing) if existing > incoming_generation)
}

pub fn matches_generation(existing_generation: Option<u64>, expected_generation: u64) -> bool {
    matches!(existing_generation, Some(existing) if existing == expected_generation)
}

#[cfg(test)]
mod tests {
    use super::{accepts_generation, matches_generation};

    #[test]
    fn accepts_missing_equal_and_newer_generations() {
        assert!(accepts_generation(None, 1));
        assert!(accepts_generation(Some(1), 1));
        assert!(accepts_generation(Some(1), 2));
    }

    #[test]
    fn rejects_older_generations() {
        assert!(!accepts_generation(Some(2), 1));
    }

    #[test]
    fn matches_exact_generations_for_attach_or_remove() {
        assert!(matches_generation(Some(7), 7));
        assert!(!matches_generation(Some(7), 6));
        assert!(!matches_generation(None, 7));
    }
}
