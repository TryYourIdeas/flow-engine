CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "You are not on the main branch. Please switch to the main branch and try again."
  exit 1
fi

rm .output -rf
git add .output
git commit -m "config: remove old build"

PREV_TAG=$(git rev-parse production/current)
# fix, bugfix, secfix, refactor, docs, config changes: are patch changes.
# feature: are minor changes
# breaking: are major changes
CHANGE=patch
if git log $PREV_TAG..HEAD --grep="feature:" -i | grep -q .; then
  CHANGE=minor
fi
if git log $PREV_TAG..HEAD --grep="feat:" -i | grep -q .; then
  CHANGE=minor
fi
if git log $PREV_TAG..HEAD --grep="breaking:" -i | grep -q .; then
  CHANGE=major 
fi

# set the new release version number
npm version $CHANGE -m "Release version: %s"


