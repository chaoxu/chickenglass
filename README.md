# chickenglass

***Under development, don't use!***

Note taking tool for mathematicians.

If you are looking for a mature tool with many features, try [Quarto](https://quarto.org/).

This project is mainly for someone who creates a collection of static content of mathematical flavor in HTML (or LaTeX) and want a markdown like writing process.

The project would provide some filters to solve the following problems in standard markdown.

# Philosophy
 - Write in Pandoc markdown
 - Postprocess with filters

# Support
 - Label/References
 - Theorem Environment

# Tests

Don't forget to install python requirements and Pandoc.

In the main directory, try the following.
```
mkdir _site
cd example
../chickglass.py test.md --config config.yml > ../_site/out.html
cp test.css ../_site/test.css
```