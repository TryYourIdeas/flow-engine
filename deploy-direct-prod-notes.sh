# get release notes
PREV_TAG=$(git rev-parse production/current)

# create release notes
VERSION_TAG=$(node -p -e "require('./package.json').version")
NOTES=$(git log $PREV_TAG..HEAD --oneline)

echo "Release version $VERSION_TAG"
echo "=================================" >> NEW_RELEASE_NOTES.txt
echo "Release version $VERSION_TAG" >> NEW_RELEASE_NOTES.txt
echo "------------------------------" >> NEW_RELEASE_NOTES.txt
echo $NOTES >> NEW_RELEASE_NOTES.txt
cat RELEASE_NOTES.txt >> NEW_RELEASE_NOTES.txt
rm RELEASE_NOTES.txt
mv NEW_RELEASE_NOTES.txt RELEASE_NOTES.txt

BUILD_DIRECTORY=$(jq -r '.buildDirectory' ./project-config.json)

if [ -n "$BUILD_DIRECTORY" ]; then
    mv $BUILD_DIRECTORY .output
fi

# using -f to add node_modules
git add .output -f
git add RELEASE_NOTES.txt
git commit -m "config: preparing release"

# delete previous production current
git tag -d production/current
git push production --delete production/current

# update  production current
VERSION_TAG=$(node -p -e "require('./package.json').version")
git tag -a production/current -m "Release version $VERSION_TAG"

#push
git push production production/current

