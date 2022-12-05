# chickenglass

***Under development, don't use!***

Note taking tool for mathematicians.

If you are looking for a mature tool with many features, try [Quarto](https://quarto.org/).

This project is mainly for someone who creates a collection of static content of mathematical flavor in HTML (or LaTeX) and want a markdown like writing process.

The project would provide some filters to solve the following problems in standard markdown.

# Philosophy
 - Write in [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown)
 - Postprocess with [Pandoc filters](https://pandoc.org/filters.html)

This allows one to directly adopt any pandoc filter, and also use these filters in your own work.

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

# Roadmap

 - Add a build system based on [Shake](https://shakebuild.com/)
 - Add helpful authoring tools 
   - VS code plugin
   - [livereloadx](https://nitoyon.github.io/livereloadx/) for preview
 - More robust crossref
 - Cross file ref support
 - Package for simple deployment