import prMetadata from '../../fixtures/pr-metadata.json';
import prFiles from '../../fixtures/pr-files.json';
import prComments from '../../fixtures/pr-comments.json';
import prReviews from '../../fixtures/pr-reviews.json';
import prReviewThreads from '../../fixtures/pr-review-threads.json';
import prDiff from '../../fixtures/pr-diff.patch?raw';

// Large real-world PR (kubernetes/kubernetes#139355: 155 files, +26k/-5.5k).
// Used to stress-test the worker pool + virtualization. Toggle via
// localStorage 'reviews-plus:stress' = '1'.
import stressMetadata from '../../fixtures/stress/pr-metadata.json';
import stressFiles from '../../fixtures/stress/pr-files.json';
import stressDiff from '../../fixtures/stress/pr-diff.patch?raw';

export {
  prMetadata,
  prFiles,
  prComments,
  prReviews,
  prReviewThreads,
  prDiff,
  stressMetadata,
  stressFiles,
  stressDiff,
};
